import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  auth,
  db,
  FIRESTORE_COLLECTIONS,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  collection,
} from "@/lib/firebase";
import type { Database, CurrentUser, Section, JournalEntry } from "@/lib/types";
import { uid, ADMIN_EMAILS, DEFAULT_DB, ROLE_SECTIONS, deviceLabel } from "@/lib/helpers";
import { encryptAndStore, decryptFromStorage, clearSecureStorage } from "@/lib/secureStorage";
import {
  ENTITY_COLLECTIONS,
  executeBatch,
  subscribeToCollection,
  subscribeToParams,
  saveParams,
  createEntity,
  migrateFromLegacy,
  type BatchOperation,
} from "@/lib/firestoreService";
import { checkRateLimit } from "@/lib/monitoring";
import { createAuditEntry, getNextSequence, getLastHash, type AuditEntry } from "@/lib/auditChain";
import { enqueueOperation, isOnline, updateLastSync, clearSyncQueue, loadSyncQueue, onConnectivityChange } from "@/lib/offlineSync";

type SyncStatus = "disconnected" | "syncing" | "synced" | "error";

interface AppContextType {
  DB: Database;
  setDB: React.Dispatch<React.SetStateAction<Database>>;
  currentUser: CurrentUser | null;
  currentSection: Section;
  setCurrentSection: (s: Section) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  saveDB: (newDB?: Database) => Promise<void>;
  logActivity: (type: string, module: string, details: string) => void;
  isLoading: boolean;
  loginError: string;
  firebaseReady: boolean;
  allowedSections: string[];
  syncStatus: SyncStatus;
  lastSyncTime: string;
  syncNow: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

// Architecture Phase 2 : 1 document = 1 entité
// Toutes les collections utilisent le nouveau firestoreService
// Le META_FIELDS reste pour la compatibilité avec les données légères
const ENTITY_FIELDS = [
  "ventes", "clients", "production", "depenses", "recouvrements",
  "livraisons", "commerciaux", "livreurs", "maintenance", "versements", "apports",
  "vehicules", "vehiculeOps", "mouvementsStock", "journal", "history", "notifications",
  "reconciliations", "users", "corbeille", "backups", "stockControles",
] as const;

// Données légères restant dans un document unique (params)
// "commandes" rejoint ce groupe (comme livreurs/commerciaux) : carnet de
// commandes téléphoniques, volume attendu bien plus faible que ventes, donc
// pas besoin du sync par-document de firestoreService pour l'instant. Si le
// volume grossit significativement (des milliers de commandes), migrer vers
// ENTITY_COLLECTIONS comme "ventes" pour éviter la réécriture intégrale du
// document meta/data à chaque sauvegarde.
const META_FIELDS = [
  "commerciaux", "livreurs", "producteurs", "avances", "employes",
  "maintenance", "vehicules", "commandes",
  "vehiculeOps", "users", "params",
  "approvals", "auditChain",
  // Rubrique Actionnaires (2026-09-06) : registre + mouvements financiers,
  // même format léger single-doc que "employes"/"commerciaux" (volume très
  // faible attendu). Réservés aux admins — voir ADMIN_ONLY_META_FIELDS
  // ci-dessous et firestore.rules match /meta/{docId} (mêmes garanties que
  // users/params, données financières/actionnariat sensibles).
  "actionnaires", "mouvementsActionnaires",
] as const;

// Flag pour détecter si la nouvelle architecture est active
let useNewArchitecture = false;

// ─── Protection globale des paramètres ─────────────────────────────────────────
// Garantit que les params ont TOUJOURS toutes les clés requises avec des valeurs valides
// Même si Firestore renvoie un objet partiel ou si un composant écrit un objet incomplet
const DEFAULT_PARAMS = DEFAULT_DB.params;

function normalizeParams(params: any): typeof DEFAULT_PARAMS {
  if (!params || typeof params !== "object") return { ...DEFAULT_PARAMS };
  return {
    taux: (typeof params.taux === "number" && params.taux >= 0) ? params.taux : DEFAULT_PARAMS.taux,
    tauxSachetsParKg: (typeof params.tauxSachetsParKg === "number" && params.tauxSachetsParKg > 0) ? params.tauxSachetsParKg : DEFAULT_PARAMS.tauxSachetsParKg,
    soldeOuverture: (typeof params.soldeOuverture === "number") ? params.soldeOuverture : DEFAULT_PARAMS.soldeOuverture,
    prixRouleau: (typeof params.prixRouleau === "number" && params.prixRouleau > 0) ? params.prixRouleau : DEFAULT_PARAMS.prixRouleau,
    prixPack: (typeof params.prixPack === "number" && params.prixPack > 0) ? params.prixPack : DEFAULT_PARAMS.prixPack,
    prixCarton: (typeof params.prixCarton === "number" && params.prixCarton > 0) ? params.prixCarton : DEFAULT_PARAMS.prixCarton,
    packsParCarton: (typeof params.packsParCarton === "number" && params.packsParCarton > 0) ? params.packsParCarton : DEFAULT_PARAMS.packsParCarton,
    bonusSeuil: (typeof params.bonusSeuil === "number" && params.bonusSeuil > 0) ? params.bonusSeuil : DEFAULT_PARAMS.bonusSeuil,
    // Préserver les clés optionnelles si elles existent
    ...(params.autoBackup !== undefined && { autoBackup: params.autoBackup }),
    ...(params.clotures && { clotures: params.clotures }),
    // Liste plate des dates verrouillées, maintenue par createCloture/
    // annulerCloture (lib/cloture.ts) et par cloturerCaisse/annulerCloture
    // (cloud-functions/src/index.ts) — c'est le seul champ que
    // firestore.rules peut tester pour bloquer une écriture sur une journée
    // clôturée (voir le commentaire en tête de firestore.rules, durci
    // 2026-08-29). Même piège que primesPaliers/budgetsDepenses ci-dessus :
    // doit être listée ici, sinon un simple enregistrement de Paramètres par
    // un admin l'efface silencieusement de params/global au prochain
    // rechargement, ré-ouvrant toutes les journées déjà clôturées.
    ...(params.clotureesDates && { clotureesDates: params.clotureesDates }),
    ...(params.analytique && { analytique: params.analytique }),
    ...(typeof params.objectifProductionMensuel === "number" && params.objectifProductionMensuel > 0 && { objectifProductionMensuel: params.objectifProductionMensuel }),
    // Grille de primes sur objectif (ObjectifsSection.tsx) — voir types.ts
    // DBParams.primesPaliers. Doit être listée ici comme les autres clés
    // optionnelles ci-dessus, sinon normalizeParams() la supprime
    // silencieusement à chaque rechargement (même piège que les autres clés
    // optionnelles de params).
    ...(params.primesPaliers && { primesPaliers: params.primesPaliers }),
    // Budget par catégorie de dépense + seuil d'approbation des dépenses
    // (ParametresSection.tsx) — voir types.ts DBParams.budgetsDepenses /
    // .seuilApprobationDepense. Même piège que primesPaliers ci-dessus :
    // toute clé optionnelle de params doit être listée ici explicitement,
    // sinon normalizeParams() la supprime silencieusement à chaque
    // rechargement.
    ...(params.budgetsDepenses && { budgetsDepenses: params.budgetsDepenses }),
    ...(typeof params.seuilApprobationDepense === "number" && params.seuilApprobationDepense > 0 && { seuilApprobationDepense: params.seuilApprobationDepense }),
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [DB, setDB] = useState<Database>({ ...DEFAULT_DB });
  const [storageLoaded, setStorageLoaded] = useState(false);

  // Charger les données au démarrage depuis le stockage local chiffré (AES-GCM).
  // Un fallback synchrone en clair existait ici auparavant ("ma2f_db_sync") pour
  // un affichage instantané au chargement, mais il écrivait l'intégralité de la
  // base (ventes, clients, caisse, dépenses...) en clair dans localStorage —
  // lisible par une extension navigateur malveillante ou toute personne ayant
  // accès au poste. Supprimé (2026-08-29, audit sécurité) : le déchiffrement
  // AES-GCM depuis IndexedDB est quasi instantané, et l'écran "Connexion à
  // Firebase..." (App.tsx) masque déjà ce court instant de toute façon.
  useEffect(() => {
    decryptFromStorage().then((data) => {
      if (data) {
        const normalized = { ...(data as Database), params: normalizeParams((data as any).params) };
        setDB(normalized);
      }
      setStorageLoaded(true);
    });
  }, []);

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [currentSection, setCurrentSection] = useState<Section>("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("disconnected");
  const [lastSyncTime, setLastSyncTime] = useState("");
  const unsubRef = useRef<(() => void)[]>([]);
  const dbRef = useRef(DB);
  const currentUserRef = useRef(currentUser);
  // Timestamp de la dernière sauvegarde locale - ignore les listeners Firestore pendant 5s après un save
  // Initialisé à Date.now() pour protéger les données locales au démarrage (empêche Firestore d'écraser les données locales fraîches)
  const lastLocalSaveRef = useRef<number>(Date.now());
  // ISO timestamp de la dernière sauvegarde réussie vers Firestore (pour comparaison de fraîcheur)
  const localLastUpdateRef = useRef<string>(localStorage.getItem("ma2f_last_update") || "");
  // Dernier état connu (synchronisé) de chaque collection à documents individuels,
  // utilisé pour calculer un DIFF avant écriture — voir saveToFirestore. Sans ce
  // diff, une sauvegarde par un utilisateur A pouvait écraser tout le tableau
  // Firestore avec sa copie locale, effaçant silencieusement une entrée que
  // l'utilisateur B venait d'ajouter (ex: recouvrements, dépenses).
  const lastSyncedItemsRef = useRef<Record<string, any[]>>({});
  // Même rôle que lastSyncedItemsRef, mais pour les champs tableau du document
  // unique meta/data (commandes, livreurs, commerciaux, véhicules, users,
  // etc. — voir META_FIELDS). Sert de base à la fusion 3 voies dans
  // saveToFirestore : sans elle, chaque sauvegarde réécrivait EN BLOC le
  // tableau local par-dessus tout Firestore (setDoc sans merge d'éléments —
  // Firestore ne fusionne jamais un tableau élément par élément, même avec
  // {merge:true}, il le remplace intégralement), ce qui effaçait
  // silencieusement toute commande/livreur/etc. ajouté entre-temps par un
  // autre utilisateur/onglet dont la copie locale de CE client n'avait pas
  // encore connaissance (fenêtre d'anti-écho, latence réseau...). C'est très
  // probablement la cause de commandes tapées dans CommandesSection.tsx qui
  // "disparaissent" : une commande B, enregistrée avec succès dans Firestore,
  // se fait écraser par la sauvegarde suivante d'un client A dont l'état
  // local ne la contenait pas encore.
  const lastSyncedMetaItemsRef = useRef<Record<string, any[]>>({});
  // Vrai dès que le listener meta/data a reçu au moins un instantané Firestore
  // (existant ou confirmé absent) pour la session en cours. Le document
  // meta/data (commerciaux, livreurs, params, etc.) est réécrit EN ENTIER à
  // chaque sauvegarde (setDoc sans merge, pas de diff comme pour les autres
  // collections) — si un saveDB() se déclenche avant que ce premier
  // instantané soit arrivé, DB.livreurs/commerciaux/params etc. valent encore
  // leurs valeurs par défaut (vides), et cette écriture écrase silencieusement
  // les vraies données Firestore avec du vide. C'est très probablement ce qui
  // a effacé des commerciaux/livreurs/paramètres de caisse existants : voir
  // le garde-fou dans saveToFirestore qui bloque l'écriture meta tant que
  // metaLoadedRef.current est encore false.
  const metaLoadedRef = useRef(false);
  // Même rôle que metaLoadedRef, mais pour le document params/global (écrit
  // via saveParams avec merge:true — voir garde-fou correspondant dans
  // saveToFirestore). Séparé de metaLoadedRef car il s'agit d'un listener/
  // document Firestore distinct, avec son propre timing d'arrivée.
  const paramsLoadedRef = useRef(false);
  // Horodatage de la dernière écriture locale PAR collection (ventes, clients,
  // etc.) — voir saveToFirestore. Contrairement à lastLocalSaveRef (global,
  // volontairement retiré de la boucle ci-dessous pour éviter les faux
  // anti-échos entre collections différentes), celui-ci ne protège que la
  // collection concernée : si l'écriture Firestore d'une vente échoue (ex:
  // permissions), le retour du listener onSnapshot — qui contient alors
  // l'état serveur sans cette vente — ne l'efface pas de l'écran
  // instantanément ; ça laisse le temps de voir l'indicateur "Erreur sync"
  // plutôt que de voir la ligne disparaître dans la seconde.
  const lastFieldSaveRef = useRef<Record<string, number>>({});
  const migrationRanRef = useRef(false);
  // Vrai dès que le listener onSnapshot d'UNE collection à documents
  // individuels (clients, livraisons, ventes, dépenses, etc. — voir
  // `entityCollections` dans setupFirestoreSync) a reçu au moins un
  // instantané Firestore réel pour la session en cours, qu'il soit vide ou
  // non. Sert de garde-fou dans saveToFirestore : le diff qui décide quels
  // documents supprimer (lastSyncedItemsRef vs les données locales
  // actuelles) ne doit JAMAIS tourner pour un champ dont on n'a pas encore
  // reçu la vraie photo Firestore dans cette session — sinon lastSyncedItemsRef
  // vaut encore {} (donc prevItems = []) alors que les données locales
  // pourraient être un état transitoire incomplet (rechargement de page,
  // écran affiché avant la fin du chargement...), et toute sauvegarde
  // déclenchée entre-temps (même par une action sur un tout autre module)
  // écrirait silencieusement les bons documents mais n'en supprimerait aucun
  // à tort SEULEMENT si prevItems reste vide — le vrai risque est le cas
  // inverse : une fois le premier instantané reçu (prevItems = liste réelle
  // complète), si les données locales redeviennent transitoirement
  // incomplètes pour ce champ avant la sauvegarde suivante, le diff
  // interprète chaque document manquant comme "supprimé par l'utilisateur"
  // et envoie un vrai deleteDoc — sans jamais passer par logActivity/Corbeille,
  // donc sans aucune trace dans le Journal. C'est très probablement ce qui a
  // effacé des clients et des réceptions rouleaux (livraisons) début/mi-août
  // 2026 sans qu'aucune suppression manuelle n'apparaisse dans le Journal —
  // même classe de bug que celle déjà corrigée pour meta/data (metaLoadedRef)
  // et params/global (paramsLoadedRef) ci-dessus, jamais étendue à ces
  // collections-ci. Tant que ce drapeau n'est pas true pour un champ donné,
  // saveToFirestore saute entièrement ce champ (ni set, ni delete) plutôt que
  // de risquer un diff contre une base de référence pas encore fiable.
  const collectionsLoadedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    dbRef.current = DB;
  }, [DB]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseReady(true);
      if (user) {
        loadUserProfile(user.email || "", user.uid);
      } else {
        setCurrentUser(null);
        setSyncStatus("disconnected");
      }
    });
    return () => unsub();
  }, []);

  // Rafraîchit périodiquement le token Firebase (custom claims) pendant la
  // session ouverte. Sans ça, si un admin change le rôle d'un utilisateur
  // déjà connecté (via la rubrique Utilisateurs), son token garde l'ancien
  // rôle jusqu'à expiration naturelle (~1h) ou reconnexion — et toutes ses
  // écritures Firestore continuent d'échouer avec "Missing or insufficient
  // permissions" en attendant. Un rafraîchissement forcé toutes les 5 min
  // fait remonter un changement de rôle bien plus vite, sans devoir demander
  // à l'utilisateur de se déconnecter/reconnecter.
  useEffect(() => {
    const interval = setInterval(() => {
      auth.currentUser?.getIdToken(true).catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);


  const loadUserProfile = useCallback(async (email: string, fbUid: string) => {
    const emailLower = email.toLowerCase();
    const currentDB = dbRef.current;
    let entry = currentDB.users.find(
      (u) => (u.email || "").toLowerCase() === emailLower
    );

    if (entry && entry.actif === false) {
      firebaseSignOut(auth);
      setLoginError("Ce compte est désactivé. Contactez l'administrateur.");
      return;
    }

    // Résolution des rôles : DB locale (config admin) > custom claims > fallback
    // La DB locale reflète toujours la dernière configuration faite par l'admin
    let roles: string[];
    let rolesSource: "claims" | "db" | "fallback" = "fallback";

    if (ADMIN_EMAILS.includes(emailLower)) {
      roles = ["admin"];
      rolesSource = "db";
    } else if (entry?.roles?.length) {
      roles = entry.roles;
      rolesSource = "db";
    } else if (entry?.role) {
      roles = [entry.role];
      rolesSource = "db";
    } else {
      // Fallback: tenter les custom claims Firebase
      try {
        const firebaseUser = auth.currentUser;
        if (firebaseUser) {
          const tokenResult = await firebaseUser.getIdTokenResult(true);
          const claimRole = tokenResult.claims.role as string | undefined;
          const claimRoles = tokenResult.claims.roles as string[] | undefined;
          if (claimRole && claimRole !== "undefined") {
            roles = claimRoles && Array.isArray(claimRoles) ? claimRoles : [claimRole];
            rolesSource = "claims";
          }
        }
      } catch {
        // Si échec de lecture des claims, on continue
      }
      if (!roles!) {
        roles = ["lecteur"];
        rolesSource = "fallback";
      }
    }

    const user: CurrentUser = {
      nom: entry?.nom || email,
      email,
      roles,
      role: roles[0],
      uid: fbUid,
      actif: true,
    };

    setCurrentUser(user);

    // Log la source des rôles pour débogage
    console.info(`[Auth] Rôles résolus pour ${emailLower}: ${roles.join(", ")} (source: ${rolesSource})`);

    if (!entry) {
      const newUser = {
        id: uid(),
        nom: user.nom,
        login: emailLower.split("@")[0],
        email,
        roles,
        role: roles[0],
        actif: true,
      };
      setDB((prev) => {
        const updated = { ...prev, users: [...prev.users, newUser] };
        encryptAndStore(updated);
        return updated;
      });
    }

    // IMPORTANT : on passe roles explicitement plutôt que de laisser
    // setupFirestoreSync lire currentUserRef.current — ce ref n'est mis à
    // jour que par un useEffect qui se déclenche APRÈS ce render (voir le
    // même problème documenté juste en dessous pour la migration), donc au
    // tout premier login isAdminUser y retomberait sur "pas admin" même pour
    // un admin, et le listener backups ne s'ouvrirait jamais pour lui.
    setupFirestoreSync(roles);
    // Migration ponctuelle : convertit les anciens documents "collection/data"
    // (tableau unique) en documents individuels par entrée.
    // Voir migrateArrayCollectionsToPerDocument pour le détail.
    // IMPORTANT : on passe user.role explicitement plutôt que de lire
    // currentUserRef.current — ce ref n'est mis à jour que par un useEffect
    // qui se déclenche APRÈS le re-render déclenché par setCurrentUser(user)
    // ci-dessus, donc à ce stade il contient encore l'ancienne valeur (null
    // au tout premier login). Résultat : la vérification de rôle échouait
    // systématiquement et la migration ne se déclenchait JAMAIS, sur aucun
    // client, même après redémarrage.
    migrateArrayCollectionsToPerDocument(user.role);
  }, []);

  const setupFirestoreSync = useCallback((rolesOverride?: string[]) => {
    // Unsubscribe from previous listeners
    unsubRef.current.forEach((unsub) => unsub());
    unsubRef.current = [];

    setSyncStatus("syncing");

    // rolesOverride est passé explicitement par loadUserProfile (voir son
    // commentaire "IMPORTANT" un peu plus bas) car currentUserRef.current
    // n'est pas encore à jour au tout premier login — sans ce paramètre, le
    // calcul d'admin ci-dessous retomberait sur l'ancien user (ou null) et
    // rouvrirait le même bug pour le tout premier chargement de session.
    const effectiveRoles = rolesOverride
      ?? currentUserRef.current?.roles
      ?? (currentUserRef.current?.role ? [currentUserRef.current.role] : []);
    const isAdminUser = effectiveRoles.includes("admin");

    // ─── Architecture Phase 2 : 1 document = 1 entité ───────────────────
    // Écouter chaque collection d'entités individuellement
    const entityCollections: Record<string, string> = {
      ventes: ENTITY_COLLECTIONS.ventes,
      clients: ENTITY_COLLECTIONS.clients,
      production: ENTITY_COLLECTIONS.production,
      depenses: ENTITY_COLLECTIONS.depenses,
      recouvrements: ENTITY_COLLECTIONS.recouvrements,
      livraisons: ENTITY_COLLECTIONS.livraisons,
      emballages: ENTITY_COLLECTIONS.emballages,
      versements: ENTITY_COLLECTIONS.versements,
      apports: ENTITY_COLLECTIONS.apports,
      mouvementsStock: ENTITY_COLLECTIONS.mouvementsStock,
      journal: ENTITY_COLLECTIONS.journal,
      history: ENTITY_COLLECTIONS.history,
      // Rappels internes (NotificationBell.tsx / CreancesSection.tsx, voir
      // types.ts Notification, added 2026-08-21) — collection à documents
      // individuels comme les autres ci-dessus, même si le volume attendu
      // reste modeste : contrairement à "commandes" (META_FIELDS), un
      // rappel est écrit par un admin puis modifié (lu/luLe) par UNE seule
      // autre personne (le destinataire), donc le diff par-document ici
      // évite tout risque qu'une sauvegarde meta/data générale n'écrase le
      // "lu" d'un rappel pendant que quelqu'un d'autre modifie autre chose.
      notifications: ENTITY_COLLECTIONS.notifications,
      reconciliations: ENTITY_COLLECTIONS.reconciliations,
      corbeille: ENTITY_COLLECTIONS.corbeille,
      stockControles: ENTITY_COLLECTIONS.stockControles,
      // "backups" est volontairement exclu de cette boucle générique : chaque
      // sauvegarde peut à elle seule approcher la limite Firestore de 1 Mo par
      // document, donc les stocker toutes dans un seul document "backups/data"
      // (comme les autres collections) finit par dépasser cette limite et fait
      // échouer l'écriture. Voir le listener dédié `backups` plus bas, qui
      // traite chaque sauvegarde comme un document Firestore séparé.
    };

    Object.entries(entityCollections).forEach(([field, collName]) => {
      // Écouter la collection Firestore
      const collRef = collection(db, collName);
      const unsub = onSnapshot(
        collRef,
        (snapshot: any) => {
          let firestoreItems: any[] | null = null;

          if (snapshot.empty) {
            // Collection vide dans Firestore (tous les docs supprimés)
            firestoreItems = [];
          } else {
            // Chercher d'abord le document 'data' (format array items)
            const dataDoc = snapshot.docs.find((d: any) => d.id === "data");
            if (dataDoc) {
              // Format document unique avec array items — source de vérité
              const data = dataDoc.data();
              firestoreItems = data.items || [];
            } else {
              // Nouveau format : chaque doc est une entité
              useNewArchitecture = true;
              firestoreItems = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            }
          }
          // NOTE — Ancien anti-boucle global (5s) SUPPRIMÉ : il utilisait un
          // timestamp partagé par TOUTES les collections, donc la sauvegarde
          // d'un utilisateur sur UNE collection (ex: une vente) faisait
          // ignorer aux autres clients les mises à jour Firestore d'UNE AUTRE
          // collection (ex: un recouvrement) pendant 5s. Remplacé par une
          // fenêtre de grâce PAR COLLECTION (lastFieldSaveRef) : ça évite ce
          // problème de contamination inter-collections tout en empêchant
          // qu'un échec d'écriture (ex: permissions insuffisantes) ne fasse
          // disparaître de l'écran, en pleine saisie, une ligne tout juste
          // ajoutée — le temps que l'indicateur "Erreur sync" soit visible
          // plutôt qu'un retour silencieux à l'état serveur.
          const timeSinceFieldSave = Date.now() - (lastFieldSaveRef.current[field] || 0);
          if (timeSinceFieldSave < 4000) return;
          if (firestoreItems !== null) {
            setDB((prev) => {
              const localItems = (prev as any)[field] || [];
              // Comparer les contenus : si identiques, ne pas re-render
              if (JSON.stringify(localItems) === JSON.stringify(firestoreItems)) {
                return prev;
              }
              const updated = { ...prev, [field]: firestoreItems };
              encryptAndStore(updated);
              return updated;
            });
            // Base de référence pour le prochain diff d'écriture (saveToFirestore)
            lastSyncedItemsRef.current[field] = firestoreItems;
          }
          // Marqué même si firestoreItems === null (n'arrive pas ici en
          // pratique, mais par cohérence) et surtout même si la collection
          // est vide (snapshot.empty) : "vide" est un état légitime reçu de
          // Firestore, pas un chargement manqué — voir le commentaire sur
          // collectionsLoadedRef pour le risque que ce drapeau évite.
          collectionsLoadedRef.current[field] = true;
          setSyncStatus("synced");
          setLastSyncTime(new Date().toLocaleTimeString("fr-FR"));
        },
        (error: any) => {
          console.error(`Erreur sync ${collName}:`, error);
          setSyncStatus("error");
        }
      );
      unsubRef.current.push(unsub);
    });

    // ─── Sauvegardes (backups) : 1 document Firestore par sauvegarde ────────
    // Contrairement aux autres collections, on n'agrège pas tout dans un seul
    // document "backups/data" (chaque sauvegarde peut faire plusieurs centaines
    // de Ko, donc les cumuler dépasse vite la limite de 1 Mo/document). Chaque
    // sauvegarde est son propre document, écrit/supprimé individuellement
    // depuis BackupsSection.tsx (voir saveBackupToFirestore/deleteBackupFromFirestore).
    //
    // Réservé aux admins : firestore.rules n'autorise la lecture de "backups"
    // qu'aux admins (rubrique "Sauvegardes" réservée aux admins côté UI). Sans
    // ce garde, TOUT utilisateur non-admin (caissier, commercial...) déclenchait
    // ici un "Missing or insufficient permissions" à chaque connexion — sans
    // impact sur ses données, mais faisant clignoter "Erreur sync" dans la
    // barre latérale et polluant la console à chaque session.
    if (isAdminUser) {
      const backupsCollRef = collection(db, ENTITY_COLLECTIONS.backups);
      const unsubBackups = onSnapshot(
        backupsCollRef,
        (snapshot: any) => {
          const timeSinceLastSave = Date.now() - lastLocalSaveRef.current;
          if (timeSinceLastSave < 5000) return;
          const firestoreBackups = snapshot.docs
            .filter((d: any) => d.id !== "data") // ignorer un éventuel ancien document legacy "data"
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (a.date || "").localeCompare(b.date || ""));
          setDB((prev) => {
            if (JSON.stringify(prev.backups) === JSON.stringify(firestoreBackups)) return prev;
            const updated = { ...prev, backups: firestoreBackups };
            encryptAndStore(updated);
            return updated;
          });
        },
        (error: any) => {
          console.error("Erreur sync backups:", error);
        }
      );
      unsubRef.current.push(unsubBackups);
    }

    // Écouter la collection meta (données légères : commerciaux, livreurs, etc.)
    const metaDocRef = doc(db, FIRESTORE_COLLECTIONS.meta, "data");
    const unsubMeta = onSnapshot(
      metaDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setDB((prev) => {
            const updated = { ...prev };
            META_FIELDS.forEach((field) => {
              // Anti-écho PAR CHAMP (comme lastFieldSaveRef pour les
              // collections à documents individuels) — remplace l'ancien
              // anti-écho global basé sur lastLocalSaveRef, qui bloquait
              // l'application de TOUT le document meta pendant 5s dès qu'UN
              // SEUL de ses champs venait d'être sauvegardé (ex: une
              // sauvegarde de "livreurs" retardait aussi la réception d'une
              // "commande" ajoutée entre-temps par un autre utilisateur).
              const timeSinceFieldSave = Date.now() - (lastFieldSaveRef.current[field] || 0);
              if (timeSinceFieldSave < 4000) return;
              if (field === "users") {
                // Toujours accepter les users de Firestore (y compris suppressions)
                if (Array.isArray(data.users)) {
                  (updated as any).users = data.users;
                }
              } else if (field === "params") {
                if (data.params) {
                  (updated as any).params = normalizeParams({ ...prev.params, ...data.params });
                }
              } else {
                // Accepter les données Firestore y compris les tableaux vides (suppressions)
                const firestoreVal = data[field];
                if (Array.isArray(firestoreVal)) {
                  (updated as any)[field] = firestoreVal;
                }
              }
            });
            encryptAndStore(updated);
            return updated;
          });
          // Base de référence pour la fusion 3 voies du prochain write (voir
          // lastSyncedMetaItemsRef et saveToFirestore) — mise à jour même
          // pour un champ dont l'anti-écho vient de bloquer l'affichage
          // local ci-dessus : cette référence sert au calcul du diff
          // d'écriture, pas à l'affichage, donc elle doit toujours refléter
          // le vrai dernier état Firestore reçu, comme lastSyncedItemsRef
          // pour les collections à documents individuels.
          META_FIELDS.forEach((field) => {
            if (field === "params") return;
            const val = (data as any)[field];
            if (Array.isArray(val)) lastSyncedMetaItemsRef.current[field] = val;
          });
          metaLoadedRef.current = true;
        } else {
          // Document meta/data absent dans Firestore
          // NE PAS sauvegarder aveuglément les données locales (elles peuvent être anciennes)
          // Vérifier d'abord si d'autres collections ont des données récentes
          console.info("[Listener meta] Document meta/data absent. Vérification de fraîcheur avant écriture...");
          metaLoadedRef.current = true;
          saveToFirestore(dbRef.current, false);
        }
        setSyncStatus("synced");
        setLastSyncTime(new Date().toLocaleTimeString("fr-FR"));
      },
      (error) => {
        console.error("Erreur sync meta:", error);
        setSyncStatus("error");
      }
    );
    unsubRef.current.push(unsubMeta);

    // Écouter les paramètres globaux (nouveau format)
    const unsubParams = subscribeToParams(
      (params) => {
        // Anti-boucle pour les params aussi — même correctif que pour meta :
        // ne sauter que si le premier instantané a déjà été appliqué, sinon
        // paramsLoadedRef ne passe jamais à true et saveParams reste bloqué
        // pour toute la session (voir garde-fou dans saveToFirestore).
        const timeSinceLastSave = Date.now() - lastLocalSaveRef.current;
        if (paramsLoadedRef.current && timeSinceLastSave < 2000) return;
        if (params) {
          setDB((prev) => {
            // Filtrer les métadonnées Firestore (_updatedAt, _updatedBy, _serverTimestamp)
            const cleanParams: Record<string, any> = {};
            Object.entries(params).forEach(([k, v]) => {
              if (!k.startsWith("_")) cleanParams[k] = v;
            });
            const updated = { ...prev, params: normalizeParams({ ...prev.params, ...cleanParams }) };
            encryptAndStore(updated);
            return updated;
          });
        }
        paramsLoadedRef.current = true;
      },
      (error) => console.error("Erreur sync params:", error)
    );
    unsubRef.current.push(unsubParams);
  }, []);

  // ─── Migration ponctuelle : "collection/data" (tableau) → 1 doc par entrée ─
  // Ancien format : chaque collection était stockée dans un unique document
  // Firestore "{collection}/data" avec un tableau "items". saveToFirestore
  // écrivait TOUT le tableau à chaque sauvegarde, ce qui pouvait effacer une
  // entrée ajoutée entre-temps par un autre utilisateur (voir le correctif
  // dans saveToFirestore). Cette migration bascule les données existantes
  // vers le format "1 document = 1 entrée" attendu par le nouveau code, sans
  // rien perdre : chaque item du tableau devient son propre document
  // (id du document = id de l'entrée), puis le document "data" est supprimé.
  // Idempotent et sûr si exécutée plusieurs fois / par plusieurs clients en
  // parallèle (mêmes ids, mêmes contenus).
  //
  // IMPORTANT : ouverte à tout utilisateur ayant les droits d'écriture
  // (admin/caissier/commercial — mêmes rôles que canWrite() dans
  // firestore.rules), pas seulement admin. Sans ça, tant qu'un admin ne se
  // reconnecte pas, une collection reste bloquée dans l'ancien format
  // "collection/data" : les nouvelles écritures (diff par document, voir
  // saveToFirestore) créent/suppriment des documents individuels que le
  // listener IGNORE tant que "data" existe encore — résultat, une
  // suppression (ou création) semble fonctionner à l'écran puis "revient"
  // au rafraîchissement, car on relit alors l'ancien document "data" resté
  // figé avec son contenu d'avant.
  const migrateArrayCollectionsToPerDocument = useCallback(async (role?: string) => {
    if (migrationRanRef.current) return;
    if (!role || role === "lecteur") return;
    migrationRanRef.current = true;

    const collectionsToMigrate: Record<string, string> = {
      ventes: ENTITY_COLLECTIONS.ventes,
      clients: ENTITY_COLLECTIONS.clients,
      production: ENTITY_COLLECTIONS.production,
      depenses: ENTITY_COLLECTIONS.depenses,
      recouvrements: ENTITY_COLLECTIONS.recouvrements,
      livraisons: ENTITY_COLLECTIONS.livraisons,
      emballages: ENTITY_COLLECTIONS.emballages,
      versements: ENTITY_COLLECTIONS.versements,
      apports: ENTITY_COLLECTIONS.apports,
      mouvementsStock: ENTITY_COLLECTIONS.mouvementsStock,
      journal: ENTITY_COLLECTIONS.journal,
      history: ENTITY_COLLECTIONS.history,
      notifications: ENTITY_COLLECTIONS.notifications,
      reconciliations: ENTITY_COLLECTIONS.reconciliations,
      corbeille: ENTITY_COLLECTIONS.corbeille,
      stockControles: ENTITY_COLLECTIONS.stockControles,
    };

    const CHUNK_SIZE = 25;
    for (const [field, collName] of Object.entries(collectionsToMigrate)) {
      try {
        const dataDocRef = doc(db, collName, "data");
        const snap = await getDoc(dataDocRef);
        if (!snap.exists()) continue; // déjà migré, ou collection vide
        const items: any[] = (snap.data()?.items || []).filter((it: any) => it?.id);
        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
          const chunk = items.slice(i, i + CHUNK_SIZE);
          await Promise.all(chunk.map((item) => setDoc(doc(db, collName, item.id), item)));
        }
        await deleteDoc(dataDocRef);
        console.info(`[Migration] ${collName}: ${items.length} document(s) migré(s) vers le format individuel.`);
      } catch (err) {
        console.warn(`[Migration] Échec pour ${field} (${collName}):`, err);
      }
    }
  }, []);

  // Retourne true si la sauvegarde a réellement été envoyée (même si
  // certaines parties ont été sautées par leurs garde-fous habituels —
  // metaLoadedRef/paramsLoadedRef), false si rien n'a été tenté (pas
  // d'utilisateur courant) ou si l'écriture a échoué (catch). Le flush de la
  // file hors-ligne (voir onConnectivityChange plus bas) se sert de cette
  // valeur pour ne vider la file QUE si la sauvegarde a vraiment abouti — voir
  // le commentaire sur ce point pour le bug que ça corrige.
  // "forceWrite" ne change plus le comportement depuis la suppression de la
  // vérification de fraîcheur ci-dessous (2026-08-19) — gardé dans la
  // signature uniquement pour ne pas casser ses appelants existants
  // (saveDB, syncNow, flushQueue...) sans avoir à toucher chacun d'eux.
  const saveToFirestore = async (data: Database, forceWrite = false): Promise<boolean> => {
    if (!currentUserRef.current) return false;
    const userName = currentUserRef.current.nom || "Système";
    // Rôle admin de l'utilisateur courant — calculé une seule fois ici et
    // réutilisé plus bas : (1) pour exclure users/params (et n'autoriser que
    // l'AJOUT sur approvals/auditChain) de l'écriture meta/data d'un rôle
    // opérationnel (caissier/commercial), reflet côté client de la même
    // séparation admin/opérationnel désormais appliquée par
    // firestore.rules (match /meta/{docId}) ; (2) pour la garde déjà
    // existante sur params/global un peu plus bas.
    const isAdminUser = (currentUserRef.current?.roles || [currentUserRef.current?.role]).includes("admin");

    setSyncStatus("syncing");
    console.info(`[SaveToFirestore] Début sauvegarde. Recouvrements: ${(data as any).recouvrements?.length || 0}, Versements: ${(data as any).versements?.length || 0}, Ventes: ${(data as any).ventes?.length || 0}`);

    // ─── Ancienne protection anti-écrasement (vérif de fraîcheur globale) ───
    // SUPPRIMÉE (2026-08-19) : elle bloquait l'écriture ENTIÈRE (collections +
    // meta + params) dès que Firestore semblait "plus récent", y compris pour
    // des données locales parfaitement légitimes (ex: une commande saisie
    // hors-ligne, resynchronisée à la reconnexion alors qu'un autre
    // utilisateur avait entre-temps modifié meta/data pour tout autre chose —
    // le flush échouait alors silencieusement pour de bon, la file étant
    // vidée juste après quel que soit le résultat, voir plus bas). Cette
    // protection est maintenant obsolète : les collections à documents
    // individuels utilisent déjà un diff par élément (diffedCollections
    // ci-dessous), et le document meta/data utilise désormais une fusion 3
    // voies par champ (voir lastSyncedMetaItemsRef) au lieu d'un
    // remplacement en bloc — les deux mécanismes rendent une écriture
    // "sûre" indépendamment de qui, de Firestore ou du local, est le plus
    // récent.
    try {
      // ─── Toujours sauvegarder TOUTES les collections ─────────────────
      // Correction critique : les sections utilisent saveDB() qui doit
      // persister les données dans Firestore pour survivre au rafraîchissement.
      {
        const promises: Promise<void>[] = [];

        // Fonction pour nettoyer les undefined (Firestore les refuse)
        const cleanUndefined = (obj: any): any => {
          if (Array.isArray(obj)) return obj.map(cleanUndefined);
          if (obj && typeof obj === "object" && !(obj instanceof Date)) {
            const cleaned: any = {};
            for (const [k, v] of Object.entries(obj)) {
              if (v !== undefined) cleaned[k] = cleanUndefined(v);
            }
            return cleaned;
          }
          return obj;
        };

        // ─── Collections à documents individuels (1 document = 1 entité) ───
        // Correction critique : auparavant, chaque sauvegarde écrasait TOUT
        // le tableau d'une collection en un seul document Firestore
        // ("recouvrements/data", "depenses/data", ...). Si un autre
        // utilisateur avait ajouté une entrée entre-temps et que notre copie
        // locale ne la contenait pas encore (latence du listener), notre
        // écriture effaçait silencieusement cette entrée. Corrigé en
        // calculant un DIFF avec le dernier état connu (lastSyncedItemsRef)
        // et en écrivant/supprimant uniquement les documents qui ont
        // réellement changé — deux utilisateurs qui ajoutent des entrées
        // différentes n'écrivent jamais sur le même document.
        const diffedCollections: Record<string, string> = {
          ventes: ENTITY_COLLECTIONS.ventes,
          clients: ENTITY_COLLECTIONS.clients,
          production: ENTITY_COLLECTIONS.production,
          depenses: ENTITY_COLLECTIONS.depenses,
          recouvrements: ENTITY_COLLECTIONS.recouvrements,
          livraisons: ENTITY_COLLECTIONS.livraisons,
          emballages: ENTITY_COLLECTIONS.emballages,
          versements: ENTITY_COLLECTIONS.versements,
          apports: ENTITY_COLLECTIONS.apports,
          // Anciennement "collections séparées" — même pattern d'écrasement,
          // même correctif. "backups" reste exclu : voir setupFirestoreSync.
          mouvementsStock: ENTITY_COLLECTIONS.mouvementsStock,
          journal: ENTITY_COLLECTIONS.journal,
          history: ENTITY_COLLECTIONS.history,
          notifications: ENTITY_COLLECTIONS.notifications,
          reconciliations: ENTITY_COLLECTIONS.reconciliations,
          corbeille: ENTITY_COLLECTIONS.corbeille,
          stockControles: ENTITY_COLLECTIONS.stockControles,
        };
        Object.entries(diffedCollections).forEach(([field, collName]) => {
          const newItems: any[] = cleanUndefined((data as any)[field] || []);
          const prevItems: any[] = lastSyncedItemsRef.current[field] || [];
          const prevById = new Map(prevItems.filter((it) => it?.id).map((it) => [it.id, it]));
          const newById = new Map(newItems.filter((it) => it?.id).map((it) => [it.id, it]));
          // Marqué avant même que les écritures ne partent (et non seulement en
          // cas de succès) : c'est justement l'échec (permission-denied, etc.)
          // qui doit être couvert par la fenêtre de grâce du listener.
          lastFieldSaveRef.current[field] = Date.now();

          // Créations/mises à jour : toujours sûres à envoyer, même avant le
          // premier instantané Firestore réel de ce champ (collectionsLoadedRef
          // encore false) — au pire, prevItems vaut encore [] et on ré-écrit
          // (idempotent) des documents déjà identiques côté serveur ; ça ne
          // supprime jamais rien. Sans ce comportement, une action faite tout
          // de suite après un chargement de page (ex: importer des clients
          // dans la seconde qui suit un rafraîchissement) pouvait rester
          // silencieusement locale — jamais écrite dans Firestore, et perdue
          // au prochain rafraîchissement — exactement ce qui est arrivé à
          // l'entrée Journal "Import CSV" du 2026-08-18 (voir collectionsLoadedRef).
          for (const item of newItems) {
            if (!item?.id) continue; // sécurité : jamais d'écriture sans id (écraserait "data")
            const prev = prevById.get(item.id);
            if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) {
              promises.push(setDoc(doc(db, collName, item.id), item));
            }
          }
          // Suppressions : SEULE la partie du diff qui reste derrière le
          // garde-fou collectionsLoadedRef (voir sa définition ci-dessus) —
          // celle-ci exige de savoir avec certitude que prevItems reflète le
          // vrai état Firestore avant de traiter un document manquant
          // localement comme "supprimé par l'utilisateur". C'est cette
          // asymétrie (créer = toujours sûr, supprimer = seulement si chargé)
          // qui corrige le bug du 2026-08-18 sans réintroduire celui-ci.
          if (collectionsLoadedRef.current[field]) {
            for (const prev of prevItems) {
              if (prev?.id && !newById.has(prev.id)) {
                promises.push(deleteDoc(doc(db, collName, prev.id)));
              }
            }
          }

          // Met à jour la base de référence immédiatement : si une deuxième
          // sauvegarde arrive avant la fin de celle-ci (ex: logActivity juste
          // après), son diff doit se baser sur cet état, pas sur l'ancien.
          lastSyncedItemsRef.current[field] = newItems;
        });

        // Collection meta (données légères) — un seul document Firestore pour
        // plusieurs champs tableau (commandes, livreurs, commerciaux, users,
        // véhicules, ...). Toujours gardée par metaLoadedRef (sinon
        // DB.livreurs/commerciaux/etc., encore à leur valeur par défaut vide
        // à ce stade, écraseraient des données réelles déjà enregistrées —
        // voir metaLoadedRef, mis à true uniquement une fois le premier
        // instantané meta réellement appliqué à DB).
        //
        // Fusion 3 voies par champ (2026-08-19) : auparavant chaque champ
        // était écrit EN BLOC depuis l'état local (data[field]), ce qui
        // écrasait silencieusement tout ajout fait entre-temps par un autre
        // utilisateur/onglet et pas encore reçu par CE client (fenêtre
        // d'anti-écho, latence réseau, session restée ouverte...) — Firestore
        // ne fusionne jamais un tableau élément par élément, même avec
        // {merge:true}, donc envoyer le tableau local incomplet suffisait à
        // effacer l'élément manquant côté serveur. C'est très probablement la
        // cause de commandes tapées dans CommandesSection.tsx qui
        // "disparaissaient" après avoir semblé enregistrées. Désormais, pour
        // chaque champ : on relit l'état Firestore le plus frais possible
        // (remoteFresh), on retire uniquement les éléments que CE client a
        // lui-même supprimés localement depuis son dernier état connu
        // (comparaison localBaseline vs localCurrent — même diff que
        // diffedCollections plus haut), puis on superpose l'état local
        // courant (ses propres ajouts/modifs). Résultat : un ajout concurrent
        // survit toujours, une suppression volontaire de CE client est
        // toujours propagée.
        if (!metaLoadedRef.current) {
          console.warn("[SaveToFirestore] Écriture meta ignorée : données Firestore pas encore chargées dans cette session (évite d'écraser commerciaux/livreurs/params avec du vide).");
        } else {
          const metaDocRef = doc(db, FIRESTORE_COLLECTIONS.meta, "data");
          let remoteMetaData: Record<string, any> | null = null;
          try {
            const remoteSnap = await getDoc(metaDocRef);
            remoteMetaData = remoteSnap.exists() ? remoteSnap.data() : null;
          } catch (readErr) {
            // Lecture impossible (hors-ligne, permissions transitoires...) :
            // on retombe sur le dernier état connu localement (lastSyncedMetaItemsRef)
            // plutôt que de bloquer toute la sauvegarde — mieux vaut fusionner
            // avec une base un peu ancienne que de ne rien écrire du tout.
            console.warn("[SaveToFirestore] Lecture meta/data avant fusion échouée, fusion basée sur le dernier état connu localement.", readErr);
          }

          const metaData: Record<string, any> = {
            lastUpdate: new Date().toISOString(),
            lastUpdatedBy: userName,
          };
          // "users" et "params" sont réservés aux admins (voir le
          // commentaire sur firestore.rules match /meta/{docId}) : un rôle
          // opérationnel ne les inclut plus du tout dans son écriture,
          // plutôt que de recalculer une fusion qui de toute façon serait
          // rejetée dès qu'elle diffère de l'état distant — ce qui aurait
          // fait échouer TOUTE la sauvegarde meta/data (commandes, livreurs,
          // etc. compris), puisque c'est un unique setDoc() pour tout le
          // document. `{ merge: true }` plus bas garantit que les omettre ne
          // les efface pas de Firestore, ça les laisse simplement intacts.
          // "approvals"/"auditChain" restent inclus normalement pour tous
          // les rôles (AJOUT nécessaire à l'usage courant — demandes
          // d'approbation, journal d'audit), la règle Firestore correspondante
          // n'autorisant de toute façon qu'un ajout, jamais une modification
          // ou suppression d'entrée existante, pour un rôle non-admin.
          const ADMIN_ONLY_META_FIELDS = new Set(["users", "params", "actionnaires", "mouvementsActionnaires"]);
          META_FIELDS.forEach((field) => {
            if (!isAdminUser && ADMIN_ONLY_META_FIELDS.has(field)) return;
            lastFieldSaveRef.current[field] = Date.now();
            if (field === "params") {
              // Objet (pas un tableau) : copié tel quel — la vraie protection
              // pour params est sur le document params/global séparé (voir
              // paramsLoadedRef plus bas), cette copie dans meta/data reste
              // un miroir hérité de l'ancien format.
              metaData.params = cleanUndefined((data as any).params || {});
              return;
            }
            const localCurrent: any[] = cleanUndefined((data as any)[field] || []);
            const localBaseline: any[] = lastSyncedMetaItemsRef.current[field] || [];
            const remoteFresh: any[] = Array.isArray(remoteMetaData?.[field]) ? remoteMetaData![field] : localBaseline;

            const localCurrentIds = new Set(localCurrent.filter((it) => it?.id).map((it) => it.id));
            const deletedByThisClient = new Set(
              localBaseline.filter((it) => it?.id && !localCurrentIds.has(it.id)).map((it) => it.id)
            );

            const merged = new Map<string, any>();
            for (const item of remoteFresh) {
              if (item?.id && !deletedByThisClient.has(item.id)) merged.set(item.id, item);
            }
            for (const item of localCurrent) {
              if (item?.id) merged.set(item.id, item);
            }
            const mergedArray = Array.from(merged.values());
            metaData[field] = mergedArray;
            lastSyncedMetaItemsRef.current[field] = mergedArray;
          });
          // merge: true — indispensable maintenant que users/params peuvent
          // être absents de metaData pour un rôle opérationnel : un setDoc()
          // sans merge remplace TOUT le document, ce qui aurait effacé ces
          // champs de Firestore à chaque sauvegarde faite par un
          // caissier/commercial plutôt que de simplement les laisser intacts.
          promises.push(setDoc(metaDocRef, cleanUndefined(metaData), { merge: true }));
        }

        // Sauvegarder les params (normalisés pour garantir l'intégrité) —
        // même garde que meta ci-dessus, mais avec paramsLoadedRef (document
        // params/global, distinct de meta/data) : saveParams utilise
        // merge:true (donc n'efface pas les champs absents), mais écrit quand
        // même TOUS les champs présents dans data.params (soldeOuverture,
        // taux, bonusSeuil, prixPack, clotures, ...), donc si data.params est
        // encore la valeur par défaut locale (avant réception du vrai
        // document params/global), ce merge écrase silencieusement chaque
        // champ réel par sa valeur par défaut. C'est très probablement la
        // cause des écarts de caisse rapportés (soldeOuverture remis à 0).
        //
        // Réservé aux admins : firestore.rules n'autorise l'écriture de
        // "params/global" qu'aux admins (allow write: if isAdmin()). Sans ce
        // garde, TOUT utilisateur non-admin (caissier, commercial) tentait ici
        // une écriture systématiquement refusée à CHAQUE saveToFirestore —
        // Promise.all rejetait donc la sauvegarde entière (y compris les
        // autres collections déjà écrites avec succès), et le catch plus bas
        // passait syncStatus à "error" à chaque sauvegarde, même via le
        // bouton "Sync" qui affichait pourtant "Synchronisation effectuée"
        // (l'erreur est absorbée par le catch de saveToFirestore, pas
        // propagée jusqu'à syncNow). Voir même bug déjà corrigé pour le
        // listener "backups" dans setupFirestoreSync.
        if (paramsLoadedRef.current && isAdminUser) {
          promises.push(saveParams(normalizeParams(data.params) as any, userName));
        }

        await Promise.all(promises);
      }

      // Marquer le timestamp de la sauvegarde réussie (pour comparaison de fraîcheur)
      const nowISO = new Date().toISOString();
      localLastUpdateRef.current = nowISO;
      localStorage.setItem("ma2f_last_update", nowISO);
      setSyncStatus("synced");
      setLastSyncTime(new Date().toLocaleTimeString("fr-FR"));
      return true;
    } catch (e: any) {
      // Pas de popup pour l'utilisateur (trop intrusif au fil de la saisie) —
      // l'erreur reste visible dans la console et via le badge "Erreur sync"
      // du menu latéral (pastille rouge + texte), qui reflète déjà syncStatus.
      console.error("Erreur save Firestore:", e?.message, e?.code, e);
      setSyncStatus("error");
      return false;
    }
  };

  // saveDB: save to encrypted localStorage AND Firestore
  // Utilise un délai pour regrouper les sauvegardes rapprochées (saveDB + logActivity)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDB = useCallback(async (newDB?: Database) => {
    const raw = newDB || dbRef.current;
    // Protection : normaliser les params avant tout enregistrement
    const data = { ...raw, params: normalizeParams(raw.params) };
    // Mettre à jour dbRef avec les params normalisés
    dbRef.current = data;
    // Sauvegarde chiffrée (AES-GCM, IndexedDB) — seule copie locale conservée
    encryptAndStore(data);
    // Marquer le timestamp pour que les listeners ignorent les retours Firestore pendant 5s
    lastLocalSaveRef.current = Date.now();

    // Rate limiting : max 60 sauvegardes/minute
    const rateCheck = checkRateLimit("saveDB", 60);
    if (!rateCheck.allowed) {
      // Ne pas abandonner silencieusement pour de bon : la copie locale
      // (encryptAndStore ci-dessus) contient déjà la saisie,
      // mais sans ce retry programmé, Firestore ne la recevrait jamais tant
      // qu'aucune AUTRE action ne redéclenche saveDB() — un rechargement de
      // page entre-temps la ferait disparaître dès que le listener meta/data
      // réappliquerait l'état Firestore (qui ne l'a jamais reçue). On
      // réessaie donc automatiquement une fois la fenêtre d'une minute
      // écoulée, avec l'état local le plus à jour à ce moment-là.
      console.warn(`[RateLimit] Sauvegarde Firestore différée, réessai dans ${rateCheck.resetIn}s`);
      setTimeout(() => { saveDB(); }, (rateCheck.resetIn + 1) * 1000);
      return;
    }

    // Mode hors-ligne : mettre en file d'attente si déconnecté
    if (!isOnline()) {
      enqueueOperation("update", "params", "db", { timestamp: new Date().toISOString() }, currentUserRef.current?.email || "unknown", 3);
      return;
    }

    // Sauvegarde Firestore immédiate et ATTENDUE pour garantir la persistance
    // forceWrite=true car c'est une action utilisateur explicite (pas un flush automatique)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (currentUserRef.current) {
      lastLocalSaveRef.current = Date.now();
      await saveToFirestore(dbRef.current, true);
      updateLastSync();
    }
  }, []);

  // ─── Synchronisation manuelle ──────────────────────────────────────────────
  // Déclenchée par le bouton "Synchroniser" dans la barre latérale. Deux
  // actions : (1) se ré-abonner aux listeners Firestore (au cas où l'un
  // d'eux se serait déconnecté silencieusement), ce qui redonne aussitôt
  // l'état serveur le plus récent ; (2) repousser l'état local actuel vers
  // Firestore (forceWrite=true), au cas où une écriture précédente aurait
  // échoué silencieusement (ex: coupure réseau passée inaperçue).
  const syncNow = useCallback(async () => {
    if (!currentUserRef.current) return;
    setSyncStatus("syncing");
    try {
      setupFirestoreSync();
      await saveToFirestore(dbRef.current, true);
      const { toast } = await import("sonner");
      toast.success("Synchronisation effectuée");
    } catch (e: any) {
      setSyncStatus("error");
      const { toast } = await import("sonner");
      toast.error(`Erreur de synchronisation : ${e?.message || "inconnue"}`);
    }
  }, [setupFirestoreSync]);

  // ─── Flush de la sync queue à la reconnexion ──────────────────────────────
  useEffect(() => {
    const flushQueue = async () => {
      const queue = loadSyncQueue();
      if (queue.length > 0 && currentUserRef.current) {
        const ok = await saveToFirestore(dbRef.current, false);
        // Ne vider la file QUE si la sauvegarde a vraiment abouti — avant ce
        // correctif, clearSyncQueue() tournait inconditionnellement juste
        // après, y compris quand saveToFirestore avait échoué (ou, du temps
        // de l'ancienne vérification de fraîcheur, avait été bloquée sans
        // rien écrire) : une donnée saisie hors-ligne (ex: une commande) était
        // alors marquée comme "synchronisée" alors qu'elle n'avait jamais
        // atteint Firestore, et se perdait pour de bon au prochain
        // rechargement de page (le listener meta/data réappliquant l'état
        // Firestore réel, qui ne l'avait jamais reçue). Si ça échoue encore,
        // la file reste en attente pour la prochaine reconnexion.
        if (ok) clearSyncQueue();
      }
    };

    const cleanup = onConnectivityChange(
      () => {
        // Reconnexion : flush la queue avec vérification de fraîcheur
        flushQueue();
      },
      () => {
        // Déconnexion : rien à faire, saveDB gère l'enqueue
      }
    );

    // Au montage, si en ligne et queue non vide, flush avec vérification
    if (isOnline()) {
      flushQueue();
    }

    return cleanup;
  }, []);

  const logActivity = useCallback(
    (type: string, module: string, details: string) => {
      const entry: JournalEntry = {
        id: uid(),
        timestamp: new Date().toISOString(),
        type,
        module,
        details,
        userName: currentUserRef.current?.nom || "Système",
        device: deviceLabel(),
        ip: "",
      };

      const applyUpdate = (auditEntry?: AuditEntry) => {
        setDB((prev) => {
          const updated: Database = {
            ...prev,
            journal: [entry, ...prev.journal],
            ...(auditEntry ? { auditChain: [...(prev.auditChain || []), auditEntry] } : {}),
          };
          encryptAndStore(updated);
          // Sauvegarder immédiatement dans Firestore (pas de debounce)
          dbRef.current = updated;
          // Marquer le timestamp anti-boucle pour que le listener ignore le retour
          lastLocalSaveRef.current = Date.now();
          if (currentUserRef.current && isOnline()) {
            saveToFirestore(dbRef.current, true);
            updateLastSync();
          }
          return updated;
        });
      };

      // Chaîne d'audit signée (voir Comptabilité > Intégrité) : chaque action
      // génère une entrée chaînée cryptographiquement à la précédente.
      const currentChain = (dbRef.current?.auditChain || []) as AuditEntry[];
      createAuditEntry({
        sequence: getNextSequence(currentChain),
        action: type,
        module,
        entityId: entry.id,
        userId: currentUserRef.current?.uid || "",
        userEmail: currentUserRef.current?.email || "",
        userRole: currentUserRef.current?.role || "",
        details,
        previousHash: getLastHash(currentChain),
      })
        .then((auditEntry) => applyUpdate(auditEntry))
        .catch(() => applyUpdate());
    },
    []
  );

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    setLoginError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      let msg = "Email ou mot de passe incorrect";
      if (e.code === "auth/too-many-requests")
        msg = "Trop de tentatives. Réessayez dans quelques minutes.";
      else if (e.code === "auth/invalid-email") msg = "Adresse email invalide";
      else if (e.code === "auth/network-request-failed")
        msg = "Problème de réseau";
      else if (e.code === "auth/user-disabled") msg = "Ce compte est désactivé";
      setLoginError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    logActivity("logout", "Authentification", `Déconnexion de ${currentUserRef.current?.nom}`);
    // Flush ultime vers Firestore avant de couper la session locale.
    saveDB(dbRef.current);
    unsubRef.current.forEach((unsub) => unsub());
    unsubRef.current = [];
    await firebaseSignOut(auth);
    // Effacer toutes les données locales (base chiffrée + clé de chiffrement +
    // file d'attente hors-ligne + résidus en clair) : sur un poste partagé ou
    // l'appareil d'un employé qui quitte l'entreprise, rien ne doit rester
    // accessible depuis le navigateur une fois déconnecté (audit sécurité,
    // 2026-08-29). Best-effort : une erreur ici ne doit pas bloquer la
    // déconnexion elle-même.
    try {
      await clearSecureStorage();
      clearSyncQueue();
    } catch (e) {
      console.error("Erreur nettoyage stockage local à la déconnexion:", e);
    }
    dbRef.current = { ...DEFAULT_DB };
    setDB({ ...DEFAULT_DB });
    setCurrentUser(null);
    setCurrentSection("dashboard");
    setSyncStatus("disconnected");
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const allowedSections = currentUser
    ? (() => {
        // Vérifier si l'utilisateur a des permissions personnalisées
        const userRecord = DB.users.find((u) => u.email === currentUser.email);
        if (userRecord && (userRecord as any).allowedSections && (userRecord as any).allowedSections.length > 0) {
          return (userRecord as any).allowedSections as string[];
        }
        // Support multi-rôles : fusionner les sections de tous les rôles
        const roles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
        const merged = new Set<string>();
        roles.forEach((r) => {
          (ROLE_SECTIONS[r] || []).forEach((s) => merged.add(s));
        });
        return merged.size > 0 ? Array.from(merged) : ROLE_SECTIONS.lecteur;
      })()
    : [];

  return (
    <AppContext.Provider
      value={{
        DB,
        setDB,
        currentUser,
        currentSection,
        setCurrentSection,
        login,
        logout,
        resetPassword,
        saveDB,
        logActivity,
        isLoading,
        loginError,
        firebaseReady,
        allowedSections,
        syncStatus,
        lastSyncTime,
        syncNow,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
