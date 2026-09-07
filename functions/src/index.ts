import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as ExcelJS from "exceljs";
import { randomUUID } from "crypto";

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// ═══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDE AUTOMATIQUE JOURNALIÈRE À 23H (HEURE AFRIQUE DE L'OUEST - UTC+0)
// Exporte toutes les données Firestore en Excel vers Cloud Storage (bucket du
// projet Firebase). Note historique : la cible initiale était Google Drive,
// mais un compte de service n'a aucun quota de stockage personnel sur Drive
// (voir https://developers.google.com/workspace/drive/api/guides/about-shareddrives) —
// impossible à contourner sans compte Google Workspace payant (Drive partagé)
// ou délégation OAuth. Cloud Storage n'a pas cette limitation et est déjà
// facturé sur le même projet.
// ═══════════════════════════════════════════════════════════════════════════════

// Configuration : ajustez le fuseau horaire selon votre localisation
// "every day 23:00" en UTC correspond à 23h GMT (Dakar, Bamako, etc.)
// Si vous êtes en UTC+1 (Douala, Lagos), utilisez "every day 22:00"
export const dailyBackupToGoogleDrive = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("every day 23:00")
  .timeZone("Africa/Dakar") // Fuseau horaire Afrique de l'Ouest
  .onRun(async (context) => {
    console.log("🔄 Démarrage de la sauvegarde automatique journalière...");

    try {
      // 1. Lire toutes les données depuis Firestore
      const data = await readAllData();
      console.log(
        `📊 Données lues: ${data.ventes.length} ventes, ${data.production.length} productions, ${data.clients.length} clients, ` +
          `${data.commandes.length} commandes, ${data.apports.length} apports, ${data.clotures.length} clôtures`
      );

      // 2. Générer le fichier Excel
      const excelBuffer = await generateExcel(data);
      console.log("📄 Fichier Excel généré");

      // 3. Uploader vers Cloud Storage
      const fileName = `MA2F_Sauvegarde_${getDateTimeString()}.xlsx`;
      const downloadUrl = await uploadToCloudStorage(excelBuffer, fileName);
      console.log(`✅ Sauvegarde uploadée: ${fileName}`);

      // 4. Enregistrer le log dans Firestore
      await db.collection("backup_logs").add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        fileName,
        downloadUrl,
        status: "success",
        stats: {
          ventes: data.ventes.length,
          production: data.production.length,
          clients: data.clients.length,
          depenses: data.depenses.length,
          recouvrements: data.recouvrements.length,
          versements: data.versements.length,
          commandes: data.commandes.length,
          apports: data.apports.length,
          clotures: data.clotures.length,
        },
      });

      return null;
    } catch (error: any) {
      console.error("❌ Erreur sauvegarde:", error.message);

      // Log l'erreur
      await db.collection("backup_logs").add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        status: "error",
        error: error.message,
      });

      return null;
    }
  });

// ═══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDE MANUELLE (déclenchable via HTTP)
// ═══════════════════════════════════════════════════════════════════════════════
export const manualBackup = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data, context) => {
    // Vérifier que l'utilisateur est authentifié
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentification requise");
    }

    try {
      const allData = await readAllData();
      const excelBuffer = await generateExcel(allData);
      const fileName = `MA2F_Sauvegarde_${getDateTimeString()}_manuelle.xlsx`;
      const downloadUrl = await uploadToCloudStorage(excelBuffer, fileName);

      await db.collection("backup_logs").add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        fileName,
        downloadUrl,
        status: "success",
        triggeredBy: context.auth.uid,
        type: "manual",
      });

      return { success: true, fileName, downloadUrl };
    } catch (error: any) {
      throw new functions.https.HttpsError("internal", error.message);
    }
  });

// ═══════════════════════════════════════════════════════════════════════════════
// RÉGÉNÉRER UN LIEN DE TÉLÉCHARGEMENT (les liens signés expirent au bout de 7
// jours ; cette fonction permet d'en obtenir un nouveau pour un fichier déjà
// sauvegardé sans avoir à relancer toute la sauvegarde).
// ═══════════════════════════════════════════════════════════════════════════════
export const getBackupDownloadUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentification requise");
  }
  const fileName = data?.fileName;
  if (!fileName || typeof fileName !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "fileName requis");
  }
  try {
    const filePath = `backups/${fileName}`;
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new functions.https.HttpsError("not-found", "Ce fichier de sauvegarde n'existe plus");
    }
    // Génère un nouveau jeton de téléchargement Firebase Storage (voir
    // uploadToCloudStorage pour l'explication de ce choix vs URL signée GCS).
    const downloadToken = randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
    return { downloadUrl };
  } catch (error: any) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDE JSON RESTAURABLE — AUTOMATIQUE CÔTÉ SERVEUR (ajouté 2026-09-05)
// ═══════════════════════════════════════════════════════════════════════════════
// Distincte du pipeline Excel ci-dessus (qui n'est PAS restaurable dans l'app,
// juste un export lisible). La sauvegarde restaurable ("Restaurer" dans la
// rubrique Sauvegardes) vit dans BackupsSection.tsx (client) : elle prend un
// snapshot JSON complet de la base (snapshotSansBackups(DB)), l'uploade vers
// Firebase Storage sous backups_json/<id>.json, et n'écrit qu'un pointeur léger
// dans le document Firestore backups/<id> (voir CLAUDE.md, "Fix : sauvegardes
// JSON restaurables..." 2026-09-04, pour l'historique du format). Jusqu'ici,
// cette sauvegarde ne se déclenchait automatiquement qu'une fois par jour SI un
// admin avait cet onglet ouvert dans son navigateur au bon moment (setInterval
// côté client) — un jour sans personne connecté à cette page = aucune
// sauvegarde restaurable ce jour-là.
//
// Les deux fonctions ci-dessous reproduisent exactement ce mécanisme côté
// serveur, indépendamment de tout navigateur ouvert — même principe que
// dailyBackupToGoogleDrive/manualBackup pour l'Excel. Le résultat s'écrit dans
// la MÊME collection Firestore "backups" que le mécanisme client : il apparaît
// donc automatiquement dans la liste de la rubrique Sauvegardes, avec les
// mêmes boutons Télécharger/Tester l'intégrité/Restaurer (getBackupData() dans
// BackupsSection.tsx gère déjà le format storagePath, quelle que soit son
// origine). Le type "Automatique" (identique à celui déjà utilisé côté client)
// est réutilisé volontairement pour la sauvegarde programmée : la vérification
// "déjà une sauvegarde de ce type aujourd'hui" dans createJsonBackup() évite un
// doublon si un admin a AUSSI eu l'onglet ouvert le même jour, et réciproquement
// le useEffect checkAutoBackup() côté client (BackupsSection.tsx) verra cette
// sauvegarde serveur et ne recréera pas la sienne.

const JSON_BACKUPS_STORAGE_PREFIX = "backups_json";
// Même quota que MAX_BACKUPS dans BackupsSection.tsx — les deux mécanismes
// (client et serveur) partagent la même collection Firestore "backups", donc
// le même total de sauvegardes conservées.
const JSON_BACKUP_MAX = 30;

// Collections à documents individuels réellement utilisées aujourd'hui par la
// synchronisation de l'app — copié de `entityCollections` dans
// client/src/contexts/AppContext.tsx (setupFirestoreSync), PAS de
// ENTITY_COLLECTIONS dans firestoreService.ts qui liste aussi des noms
// (commerciaux, livreurs, users...) qui vivent en réalité dans meta/data (voir
// "Data model" dans CLAUDE.md pour le chevauchement volontaire entre les deux).
// Clé = nom de la collection Firestore, valeur = nom du champ dans Database
// (types.ts) — ils diffèrent pour mouvements_stock/mouvementsStock et
// stock_controles/stockControles.
const JSON_BACKUP_ENTITY_COLLECTIONS: Record<string, string> = {
  ventes: "ventes",
  clients: "clients",
  production: "production",
  depenses: "depenses",
  recouvrements: "recouvrements",
  livraisons: "livraisons",
  emballages: "emballages",
  versements: "versements",
  apports: "apports",
  mouvements_stock: "mouvementsStock",
  journal: "journal",
  history: "history",
  notifications: "notifications",
  reconciliations: "reconciliations",
  corbeille: "corbeille",
  stock_controles: "stockControles",
};

// Champs stockés en tableaux dans le document unique meta/data (META_FIELDS
// côté client, client/src/contexts/AppContext.tsx) — "params" est
// délibérément exclu ici, lu séparément depuis params/global juste après (voir
// subscribeToParams côté client, qui en fait la source de vérité actuelle).
const JSON_BACKUP_META_FIELDS = [
  "commerciaux", "livreurs", "producteurs", "avances", "employes",
  "maintenance", "vehicules", "commandes", "vehiculeOps", "users",
  "approvals", "auditChain",
];

// Reconstruit un objet au format Database (types.ts) directement depuis
// Firestore, équivalent au DB que snapshotSansBackups(DB) sérialise côté
// client — c'est ce même objet que "Restaurer" réinjecte tel quel via setDB().
async function buildFullDatabaseSnapshot(): Promise<Record<string, any>> {
  const snapshot: Record<string, any> = {};

  // 1. Collections à documents individuels
  // Logs de taille par collection : sert de diagnostic en cas d'échec (ex:
  // dépassement mémoire) — permet de voir dans les logs Cloud Functions
  // laquelle des 16 collections est anormalement volumineuse, plutôt que de
  // deviner face à une erreur "internal" générique côté client (voir
  // CLAUDE.md, incident du 2026-09-05 : premier essai en 512MB/300s a échoué
  // sans détail exploitable — mémoire/délai augmentés à 2GB/540s, ces logs
  // permettront de confirmer si c'est bien la cause si ça se reproduit).
  for (const [col, field] of Object.entries(JSON_BACKUP_ENTITY_COLLECTIONS)) {
    try {
      const snap = await db.collection(col).get();
      snapshot[field] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      console.log(`[JSON backup] ${col}: ${snapshot[field].length} document(s)`);
    } catch (e) {
      console.error(`[JSON backup] Erreur lecture collection ${col}:`, e);
      snapshot[field] = [];
    }
  }

  // 2. Document meta/data (données légères)
  let metaData: any = {};
  try {
    const metaDoc = await db.collection("meta").doc("data").get();
    if (metaDoc.exists) metaData = metaDoc.data() || {};
  } catch (e) {
    console.error("[JSON backup] Erreur lecture meta/data:", e);
  }
  JSON_BACKUP_META_FIELDS.forEach((field) => {
    snapshot[field] = Array.isArray(metaData[field]) ? metaData[field] : [];
  });

  // 3. Paramètres globaux — params/global est la source de vérité actuelle
  // (subscribeToParams côté client) ; repli sur l'ancien champ meta/data.params
  // si ce document dédié n'existe pas encore sur ce projet.
  let params: any = metaData.params || {};
  try {
    const paramsDoc = await db.collection("params").doc("global").get();
    if (paramsDoc.exists) {
      const data = paramsDoc.data() || {};
      // Filtrer les métadonnées internes (mêmes clés "_..." ignorées par le
      // listener subscribeToParams côté client).
      params = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("_")));
    }
  } catch (e) {
    console.error("[JSON backup] Erreur lecture params/global:", e);
  }
  snapshot.params = params;

  // 4. Champ non couvert par la synchronisation Firestore actuelle (voir
  // le commentaire sur Database.mouvementsStockArchive dans types.ts — ce
  // champ n'apparaît dans aucune des deux listes ci-dessus, donc rien ne
  // l'écrit vers Firestore aujourd'hui). Gardé vide plutôt qu'absent, pour
  // qu'une restauration ne casse pas sur un champ manquant.
  snapshot.mouvementsStockArchive = [];

  // "backups" est TOUJOURS exclu du contenu du snapshot lui-même — même
  // raison que snapshotSansBackups() côté client : sinon chaque sauvegarde
  // embarque une copie de toutes les précédentes et la taille explose de
  // façon quasi quadratique au fil du temps (voir le bug corrigé le
  // 2026-09-04 dans CLAUDE.md).
  snapshot.backups = [];

  return snapshot;
}

// force=true (déclenchement manuel) : ignore la vérification "déjà une
// sauvegarde de ce type aujourd'hui" — un admin qui clique explicitement veut
// un point de restauration précis à cet instant, pas "au plus tard aujourd'hui".
async function createJsonBackup(type: string, force = false): Promise<{ id: string; taille: number } | null> {
  const todayStr = new Date().toISOString().split("T")[0]; // Dakar = UTC+0, pas de décalage à gérer

  const existingSnap = await db.collection("backups").get();
  const existingDocs = existingSnap.docs.filter((d) => d.id !== "data"); // ignorer l'éventuel ancien doc legacy "backups/data"

  if (!force) {
    const hasToday = existingDocs.some((d) => {
      const data = d.data() as any;
      return typeof data.date === "string" && data.date.startsWith(todayStr) && data.type === type;
    });
    if (hasToday) return null;
  }

  const snapshotObj = await buildFullDatabaseSnapshot();
  const jsonData = JSON.stringify(snapshotObj);
  console.log(`[JSON backup] Snapshot complet généré : ${(jsonData.length / 1024 / 1024).toFixed(1)} Mo`);
  const id = randomUUID();
  const filePath = `${JSON_BACKUPS_STORAGE_PREFIX}/${id}.json`;

  await bucket.file(filePath).save(Buffer.from(jsonData, "utf-8"), {
    contentType: "application/json",
    metadata: { cacheControl: "private, max-age=0" },
  });

  const backupDoc = {
    id,
    date: new Date().toISOString(),
    type,
    taille: jsonData.length,
    storagePath: filePath,
  };
  await db.collection("backups").doc(id).set(backupDoc);

  // Rotation : garder au plus JSON_BACKUP_MAX sauvegardes au total, toutes
  // origines confondues (client ou serveur) — quota partagé, voir plus haut.
  const finalSnap = await db.collection("backups").get();
  const finalDocs = finalSnap.docs
    .filter((d) => d.id !== "data")
    .sort((a, b) => (((a.data() as any).date as string) || "").localeCompare(((b.data() as any).date as string) || ""));
  if (finalDocs.length > JSON_BACKUP_MAX) {
    const toRemove = finalDocs.slice(0, finalDocs.length - JSON_BACKUP_MAX);
    for (const d of toRemove) {
      const dData = d.data() as any;
      if (dData.storagePath) {
        try {
          await bucket.file(dData.storagePath).delete();
        } catch (e: any) {
          if (e?.code !== 404) console.error(`[JSON backup] Erreur suppression Storage ${dData.storagePath}:`, e);
        }
      }
      await d.ref.delete();
    }
  }

  return { id, taille: backupDoc.taille };
}

// Déclenchement automatique quotidien — indépendant de tout navigateur ouvert.
// Décalé de 20 min après dailyBackupToGoogleDrive (23h00) pour ne pas faire
// tourner les deux plus grosses fonctions de ce fichier exactement à la même
// seconde (celle-ci lit nettement plus de collections que l'Excel : journal,
// history, mouvementsStock, notifications, reconciliations, corbeille,
// stockControles, approvals, auditChain, users — tout ce qu'il faut pour une
// restauration complète, pas seulement un export lisible).
export const dailyJsonBackup = functions
  .runWith({ timeoutSeconds: 540, memory: "2GB" })
  .pubsub.schedule("every day 23:20")
  .timeZone("Africa/Dakar")
  .onRun(async () => {
    console.log("🔄 Démarrage de la sauvegarde JSON restaurable automatique (serveur)...");
    try {
      const created = await createJsonBackup("Automatique");
      if (created) {
        console.log(`✅ Sauvegarde JSON restaurable créée: ${created.id} (${(created.taille / 1024).toFixed(1)} Ko)`);
      } else {
        console.log("ℹ️ Sauvegarde JSON restaurable déjà présente pour aujourd'hui (client ou serveur) — rien à faire.");
      }
      return null;
    } catch (error: any) {
      console.error("❌ Erreur sauvegarde JSON restaurable:", error.message);
      await db.collection("backup_logs").add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        status: "error",
        type: "json_backup",
        error: error.message,
      });
      return null;
    }
  });

// Déclenchement manuel (admin uniquement) — pour tester le pipeline sans
// attendre 23h20, même logique que manualBackup pour l'Excel. Le rôle est
// revérifié ici côté serveur (context.auth.token.role) : contrairement à
// manualBackup/getBackupDownloadUrl ci-dessus (qui ne vérifiaient jusqu'ici
// que l'authentification, voir le correctif "Export/téléchargement des
// sauvegardes restreint aux admins" du 2026-08-30 dans CLAUDE.md), cette
// fonction est admin-only dès sa création.
export const manualJsonBackup = functions
  .runWith({ timeoutSeconds: 540, memory: "2GB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentification requise");
    }
    if (context.auth.token.role !== "admin") {
      throw new functions.https.HttpsError("permission-denied", "Réservé aux administrateurs");
    }
    try {
      const created = await createJsonBackup("Manuel (serveur)", true);
      return { success: true, id: created?.id, taille: created?.taille };
    } catch (error: any) {
      throw new functions.https.HttpsError("internal", error.message);
    }
  });

// ═══════════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════════

// Horodatage complet (date + heure + secondes), utilisé pour que chaque
// sauvegarde produise un nom de fichier unique dans Cloud Storage au lieu
// d'écraser la précédente du même jour (getDateString() seul seul donne le
// même nom pour toutes les sauvegardes manuelles déclenchées le même jour).
function getDateTimeString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}s`
  );
}

interface AllData {
  ventes: any[];
  production: any[];
  depenses: any[];
  clients: any[];
  recouvrements: any[];
  versements: any[];
  livraisons: any[];
  emballages: any[];
  apports: any[];
  maintenance: any[];
  vehicules: any[];
  vehiculeOps: any[];
  commerciaux: any[];
  livreurs: any[];
  // Commandes (carnet de commandes téléphoniques) — vit dans META_FIELDS
  // (document meta/data), pas dans une collection à documents individuels,
  // voir "Commandes" dans CLAUDE.md.
  commandes: any[];
  // Clôtures de caisse — stockées dans DBParams.clotures (donc à l'intérieur
  // de meta/data → params), pas dans une collection Firestore séparée (la
  // fonction transactionCloture() de firestoreService.ts écrit bien vers une
  // collection "clotures" côté Phase 2, mais l'app ne l'utilise pas encore
  // pour la lecture — ROLE_SECTIONS/CaisseSection.tsx lisent DB.params.clotures).
  clotures: any[];
  params: any;
}

// Bug (fixé 2026-08-18) : cette fonction lisait chaque collection via
// `db.collection(col).doc("data")` — l'ANCIEN format "un seul document par
// liste avec un champ items[]". L'app a migré vers l'architecture Phase 2
// ("1 document Firestore = 1 entité", voir `ENTITY_COLLECTIONS` dans
// `client/src/lib/firestoreService.ts` et `migrateArrayCollectionsToPerDocument`
// dans `client/src/contexts/AppContext.tsx`, qui supprime explicitement ce
// document "data" une fois la migration faite) il y a plusieurs mois — donc
// depuis, `docSnap.exists` était systématiquement faux pour ventes/clients/
// production/depenses/recouvrements/versements, et livraisons/emballages
// n'ont JAMAIS vécu dans meta/data (ce sont aussi des collections à documents
// individuels, pas des META_FIELDS) donc `metaData.livraisons`/`.emballages`
// étaient toujours undefined. Résultat : cette sauvegarde cloud "réussissait"
// chaque jour (status: "success" dans backup_logs) tout en produisant un
// Excel vide pour l'essentiel des données métier — sans jamais lever d'erreur
// visible. Fix : lire chaque collection à documents individuels avec
// `db.collection(col).get()` (tous les documents) au lieu de `.doc("data")`.
async function readAllData(): Promise<AllData> {
  // Collections à documents individuels — 1 document Firestore = 1 entité,
  // noms alignés sur ENTITY_COLLECTIONS côté client (firestoreService.ts).
  // "apports" (entrées de fonds hors ventes/recouvrements) ajouté le
  // 2026-08-18 — c'est bien une collection à documents individuels
  // (ENTITY_COLLECTIONS.apports côté client), elle avait juste été oubliée
  // ici lors du fix du bug meta/data ci-dessus. "clotures" est lue à part
  // plus bas car elle peut vivre à deux endroits (voir commentaire sur
  // AllData.clotures).
  const perDocumentCollections = [
    "ventes", "production", "depenses", "clients",
    "recouvrements", "versements", "livraisons", "emballages", "apports",
  ];

  const results: Record<string, any[]> = {};

  for (const col of perDocumentCollections) {
    try {
      const snap = await db.collection(col).get();
      results[col] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      results[col] = [];
    }
  }

  // Lire aussi la collection "clotures" à documents individuels (écrite par
  // transactionCloture() dans firestoreService.ts) — voir le merge avec
  // metaData.params.clotures plus bas.
  let clotureDocs: any[] = [];
  try {
    const snap = await db.collection("clotures").get();
    clotureDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}

  // Lire le document meta pour les données légères (commerciaux, livreurs,
  // vehicules, vehiculeOps, params, commandes, etc. — ces champs-là,
  // contrairement à ceux ci-dessus, vivent bien dans le document unique
  // meta/data — voir META_FIELDS dans client/src/contexts/AppContext.tsx).
  let metaData: any = {};
  try {
    const metaDoc = await db.collection("meta").doc("data").get();
    if (metaDoc.exists) {
      metaData = metaDoc.data() || {};
    }
  } catch {}

  const params = metaData.params || {};

  // Fusionner les deux sources possibles de clôtures de caisse : la liste
  // historique DB.params.clotures (toujours la source lue par CaisseSection.tsx
  // à ce jour) et la collection "clotures" à documents individuels (chemin
  // Phase 2, pas encore branché côté lecture client mais déjà utilisé en
  // écriture par transactionCloture()). Dédoublonnées par date — en cas de
  // doublon, la version de la collection (plus structurée, avec id) l'emporte.
  const clotureParDate = new Map<string, any>();
  (params.clotures || []).forEach((c: any) => {
    if (c && c.date) clotureParDate.set(c.date, c);
  });
  clotureDocs.forEach((c: any) => {
    if (c && c.date) clotureParDate.set(c.date, c);
  });
  const clotures = Array.from(clotureParDate.values());

  return {
    ventes: results["ventes"] || [],
    production: results["production"] || [],
    depenses: results["depenses"] || [],
    clients: results["clients"] || [],
    recouvrements: results["recouvrements"] || [],
    versements: results["versements"] || [],
    livraisons: results["livraisons"] || [],
    emballages: results["emballages"] || [],
    apports: results["apports"] || [],
    maintenance: metaData.maintenance || [],
    vehicules: metaData.vehicules || [],
    vehiculeOps: metaData.vehiculeOps || [],
    commerciaux: metaData.commerciaux || [],
    livreurs: metaData.livreurs || [],
    commandes: metaData.commandes || [],
    clotures,
    params,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALCULS FINANCIERS — dupliqués depuis client/src/lib/helpers.ts
// (cashAtSale / resteVente / computeSoldeCaisseActuel) faute de couche de
// service partagée entre l'app et ce codebase Cloud Functions séparé (voir
// "No service layer" dans CLAUDE.md — même schéma que Commande→Vente
// conversion, dupliqué plutôt que partiellement réutilisé). Si la logique
// change côté client (ex: nouvelle règle de calcul du solde de caisse),
// reporter le changement ici dans la même session pour ne pas faire diverger
// le rapport de sauvegarde du reste de l'app.
// ═══════════════════════════════════════════════════════════════════════════════

// Encaissé immédiat sur une vente (hors recouvrements ultérieurs) — même
// logique que cashAtSale() côté client : si `avance` est renseigné, c'est la
// source de vérité (plafonnée au montant total) ; sinon une vente "Payé" est
// intégralement encaissée à la vente, une vente "Crédit" ne l'est pas.
function cashAtSale(v: any, recouvrements: any[]): number {
  const montant = (v.packs || 0) * (v.prix || 0);
  const recouvTotal = recouvrements
    .filter((r) => r.venteId === v.id)
    .reduce((s, r) => s + (r.montant || 0), 0);
  if (v.avance !== undefined && v.avance !== null) return Math.min(v.avance, montant);
  return v.mode === "Payé" ? Math.max(0, montant - recouvTotal) : 0;
}

// Créance restante sur une vente à date de sauvegarde (montant total - déjà
// encaissé à la vente - recouvrements reçus depuis) — même logique que
// resteVente() côté client.
function resteVente(v: any, recouvrements: any[]): number {
  const montant = (v.packs || 0) * (v.prix || 0);
  const recouvTotal = recouvrements
    .filter((r) => r.venteId === v.id)
    .reduce((s, r) => s + (r.montant || 0), 0);
  return montant - cashAtSale(v, recouvrements) - recouvTotal;
}

// Solde de caisse actuel (balance cumulative depuis le début, jamais filtrée
// par période — voir "Balance vs flux" dans CLAUDE.md) — même formule que
// computeSoldeCaisseActuel()/computeSoldeCaisseAuDate() côté client.
function computeSoldeCaisseActuel(data: AllData): number {
  const totalEntrees =
    data.ventes.reduce((s, v) => s + cashAtSale(v, data.recouvrements), 0) +
    data.recouvrements.reduce((s, r) => s + (r.montant || 0), 0) +
    data.apports.reduce((s, a) => s + (a.montant || 0), 0) +
    (data.params.soldeOuverture || 0);

  const totalDepenses = data.depenses.reduce((s, d) => s + (d.montant || 0), 0);

  const depensesVehiculeOpsNonComptees = data.vehiculeOps.filter((op) => {
    const categorie = op.type === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule";
    return !data.depenses.some((d) => d.date === op.date && d.montant === op.montant && d.categorie === categorie);
  });
  const maintenanceNonComptee = data.maintenance.filter(
    (m) => (m.cout || 0) > 0 && !data.depenses.some((d) => d.date === m.date && d.montant === m.cout && d.categorie === "Maintenance machine")
  );
  const totalVersements = data.versements.reduce((s, v) => s + (v.montant || 0), 0);

  const totalSorties =
    totalDepenses +
    depensesVehiculeOpsNonComptees.reduce((s, op) => s + (op.montant || 0), 0) +
    maintenanceNonComptee.reduce((s, m) => s + (m.cout || 0), 0) +
    totalVersements;

  return totalEntrees - totalSorties;
}

async function generateExcel(data: AllData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MA2F AquaSachet";
  workbook.created = new Date();

  // Style d'en-tête
  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } },
    alignment: { horizontal: "center" },
  };

  // ─── RAPPORT (synthèse) ───
  // Feuille de résumé — placée en premier pour être visible à l'ouverture.
  // Totaux simples par module (nombre + montant) plutôt qu'une reconstruction
  // du Dashboard : les balances (solde de caisse, créances) réutilisent la
  // même formule canonique que l'app (voir "CALCULS FINANCIERS" ci-dessus),
  // le reste sont des sommes directes des feuilles de détail de ce classeur.
  const wsRapport = workbook.addWorksheet("RAPPORT");
  wsRapport.columns = [
    { header: "Indicateur", key: "indicateur", width: 40 },
    { header: "Valeur", key: "valeur", width: 20 },
  ];
  const totalVentesMontant = data.ventes.reduce((s, v) => s + (v.packs || 0) * (v.prix || 0), 0);
  const totalCreances = data.ventes
    .filter((v) => v.mode === "Crédit")
    .reduce((s, v) => s + resteVente(v, data.recouvrements), 0);
  const totalRecouvrements = data.recouvrements.reduce((s, r) => s + (r.montant || 0), 0);
  const totalDepenses = data.depenses.reduce((s, d) => s + (d.montant || 0), 0);
  const totalApports = data.apports.reduce((s, a) => s + (a.montant || 0), 0);
  const totalVersements = data.versements.reduce((s, v) => s + (v.montant || 0), 0);
  const totalProductionPacks = data.production.reduce((s, p) => s + (p.packs || 0), 0);
  const totalKgRouleauxRecus = data.livraisons.reduce((s, l) => s + (l.kg || 0), 0);
  const commandesParStatut: Record<string, number> = {};
  data.commandes.forEach((c) => {
    commandesParStatut[c.statut || "inconnu"] = (commandesParStatut[c.statut || "inconnu"] || 0) + 1;
  });
  const derniereCloture = [...data.clotures].sort((a, b) => (a.date || "").localeCompare(b.date || ""))[data.clotures.length - 1];

  const rapportRows: { indicateur: string; valeur: string | number }[] = [
    { indicateur: "Généré le", valeur: new Date().toLocaleString("fr-FR", { timeZone: "Africa/Dakar" }) },
    { indicateur: "— VENTES —", valeur: "" },
    { indicateur: "Nombre de ventes", valeur: data.ventes.length },
    { indicateur: "Chiffre d'affaires total (F CFA)", valeur: totalVentesMontant },
    { indicateur: "Créances totales en cours (F CFA)", valeur: totalCreances },
    { indicateur: "— CAISSE —", valeur: "" },
    { indicateur: "Solde de caisse actuel (F CFA)", valeur: computeSoldeCaisseActuel(data) },
    { indicateur: "Dernière clôture enregistrée", valeur: derniereCloture ? `${derniereCloture.date} (solde: ${derniereCloture.soldeJour ?? "-"} F CFA)` : "Aucune" },
    { indicateur: "Nombre de clôtures", valeur: data.clotures.length },
    { indicateur: "— RECOUVREMENTS / APPORTS / VERSEMENTS —", valeur: "" },
    { indicateur: "Total recouvrements (F CFA)", valeur: totalRecouvrements },
    { indicateur: "Total apports de fonds (F CFA)", valeur: totalApports },
    { indicateur: "Total versements/dépenses de caisse (F CFA)", valeur: totalVersements },
    { indicateur: "— DÉPENSES —", valeur: "" },
    { indicateur: "Nombre de dépenses", valeur: data.depenses.length },
    { indicateur: "Total dépenses (F CFA)", valeur: totalDepenses },
    { indicateur: "— PRODUCTION / RÉCEPTION ROULEAUX —", valeur: "" },
    { indicateur: "Total packs produits", valeur: totalProductionPacks },
    { indicateur: "Total kg de rouleaux plastique reçus", valeur: totalKgRouleauxRecus },
    { indicateur: "— COMMANDES —", valeur: "" },
    { indicateur: "Nombre total de commandes", valeur: data.commandes.length },
    ...Object.entries(commandesParStatut).map(([statut, n]) => ({ indicateur: `  dont statut "${statut}"`, valeur: n })),
    { indicateur: "— CLIENTS —", valeur: "" },
    { indicateur: "Nombre de clients", valeur: data.clients.length },
  ];
  rapportRows.forEach((r) => wsRapport.addRow(r));
  applyHeaderStyle(wsRapport, headerStyle);
  wsRapport.getColumn("indicateur").font = { bold: false };

  // ─── VENTES ───
  const wsVentes = workbook.addWorksheet("VENTES");
  wsVentes.columns = [
    { header: "N° BL", key: "numero", width: 12 },
    { header: "Date", key: "date", width: 12 },
    { header: "Client", key: "client", width: 20 },
    { header: "Commercial", key: "commercial", width: 15 },
    { header: "Packs", key: "packs", width: 8 },
    { header: "Prix/pack", key: "prix", width: 12 },
    { header: "Montant", key: "montant", width: 15 },
    { header: "Payé", key: "paye", width: 15 },
    { header: "Reste", key: "reste", width: 15 },
    { header: "Statut", key: "mode", width: 10 },
    { header: "Livreur", key: "livreur", width: 15 },
  ];
  data.ventes.forEach((v) => {
    const montant = (v.packs || 0) * (v.prix || 0);
    // "Payé"/"Reste" recalculés avec la même formule canonique que l'app
    // (cashAtSale/resteVente, voir "CALCULS FINANCIERS" plus haut) — l'ancien
    // code lisait `v.montantPaye`, un champ qui n'existe pas sur le type
    // `Vente` (voir client/src/lib/types.ts : le champ réel est `avance`),
    // donc "Payé" affichait toujours 0 et "Reste" toujours le montant plein.
    const paye = montant - resteVente(v, data.recouvrements);
    wsVentes.addRow({
      numero: v.numero, date: v.date, client: v.client,
      commercial: v.commercial || "", packs: v.packs, prix: v.prix,
      montant, paye, reste: resteVente(v, data.recouvrements), mode: v.mode, livreur: v.livreur || "",
    });
  });
  applyHeaderStyle(wsVentes, headerStyle);

  // ─── PRODUCTION ───
  const wsProd = workbook.addWorksheet("PRODUCTION");
  wsProd.columns = [
    { header: "N°", key: "numero", width: 10 },
    { header: "Date", key: "date", width: 12 },
    { header: "Packs", key: "packs", width: 10 },
  ];
  data.production.forEach((p) => wsProd.addRow({ numero: p.numero, date: p.date, packs: p.packs }));
  applyHeaderStyle(wsProd, headerStyle);

  // ─── DEPENSES ───
  const wsDep = workbook.addWorksheet("DEPENSES");
  wsDep.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Catégorie", key: "categorie", width: 15 },
    { header: "Libellé", key: "libelle", width: 25 },
    { header: "Fournisseur", key: "fournisseur", width: 20 },
    { header: "Montant", key: "montant", width: 15 },
  ];
  data.depenses.forEach((d) => wsDep.addRow({ date: d.date, categorie: d.categorie, libelle: d.libelle, fournisseur: d.fournisseur, montant: d.montant }));
  applyHeaderStyle(wsDep, headerStyle);

  // ─── CLIENTS ───
  const wsClients = workbook.addWorksheet("CLIENTS");
  wsClients.columns = [
    { header: "Nom", key: "nom", width: 20 },
    { header: "Type", key: "type", width: 12 },
    { header: "Zone", key: "zone", width: 15 },
    { header: "Téléphone", key: "tel", width: 15 },
    { header: "Prix/pack", key: "prix", width: 12 },
  ];
  data.clients.forEach((c) => wsClients.addRow({ nom: c.nom, type: c.type, zone: c.zone, tel: c.tel, prix: c.prix }));
  applyHeaderStyle(wsClients, headerStyle);

  // ─── COMMANDES ───
  const wsCommandes = workbook.addWorksheet("COMMANDES");
  wsCommandes.columns = [
    { header: "N°", key: "numero", width: 12 },
    { header: "Date", key: "date", width: 12 },
    { header: "Heure appel", key: "heureAppel", width: 10 },
    { header: "Client", key: "client", width: 20 },
    { header: "Téléphone", key: "tel", width: 15 },
    { header: "Zone", key: "zone", width: 15 },
    { header: "Packs", key: "packs", width: 8 },
    { header: "Commercial", key: "commercial", width: 15 },
    { header: "Livreur (id)", key: "livreurId", width: 15 },
    { header: "Statut", key: "statut", width: 14 },
    { header: "Livrée le", key: "livreeLe", width: 18 },
    { header: "Vente liée", key: "venteId", width: 15 },
  ];
  data.commandes.forEach((c) =>
    wsCommandes.addRow({
      numero: c.numero, date: c.date, heureAppel: c.heureAppel, client: c.client, tel: c.tel,
      zone: c.zone, packs: c.packs, commercial: c.commercial || "", livreurId: c.livreurId || "",
      statut: c.statut, livreeLe: c.livreeLe || "", venteId: c.venteId || "",
    })
  );
  applyHeaderStyle(wsCommandes, headerStyle);

  // ─── RECOUVREMENTS ───
  const wsRec = workbook.addWorksheet("RECOUVREMENTS");
  wsRec.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "N° BL", key: "numeroBL", width: 12 },
    { header: "Client", key: "client", width: 20 },
    { header: "Montant", key: "montant", width: 15 },
    { header: "Mode", key: "mode", width: 12 },
    { header: "Notes", key: "notes", width: 25 },
  ];
  data.recouvrements.forEach((r) => wsRec.addRow({ date: r.date, numeroBL: r.numeroBL || "-", client: r.client, montant: r.montant, mode: r.mode, notes: r.notes || "" }));
  applyHeaderStyle(wsRec, headerStyle);

  // ─── CAISSE (clôtures) ───
  const wsCaisse = workbook.addWorksheet("CAISSE");
  wsCaisse.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Clôturée par", key: "clotureePar", width: 18 },
    { header: "Clôturée le", key: "clotureeLe", width: 18 },
    { header: "Solde du jour", key: "soldeJour", width: 14 },
    { header: "Total entrées", key: "totalEntrees", width: 14 },
    { header: "Total sorties", key: "totalSorties", width: 14 },
    { header: "Total ventes", key: "totalVentes", width: 14 },
    { header: "Montant attendu", key: "montantAttendu", width: 15 },
    { header: "Montant compté", key: "montantCompte", width: 15 },
    { header: "Écart", key: "ecartCaisse", width: 12 },
    { header: "Explication écart", key: "explicationEcart", width: 25 },
  ];
  data.clotures.forEach((c) =>
    wsCaisse.addRow({
      date: c.date, clotureePar: c.clotureePar || "", clotureeLe: c.clotureeLe || "",
      soldeJour: c.soldeJour, totalEntrees: c.totalEntrees, totalSorties: c.totalSorties,
      totalVentes: c.totalVentes, montantAttendu: c.montantAttendu ?? "", montantCompte: c.montantCompte ?? "",
      ecartCaisse: c.ecartCaisse ?? "", explicationEcart: c.explicationEcart || "",
    })
  );
  applyHeaderStyle(wsCaisse, headerStyle);

  // ─── VERSEMENTS ───
  const wsVers = workbook.addWorksheet("VERSEMENTS");
  wsVers.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 12 },
    { header: "Bénéficiaire", key: "beneficiaire", width: 20 },
    { header: "Montant", key: "montant", width: 15 },
    { header: "Motif", key: "motif", width: 25 },
  ];
  data.versements.forEach((v) => wsVers.addRow({ date: v.date, type: v.type, beneficiaire: v.beneficiaire, montant: v.montant, motif: v.motif || "" }));
  applyHeaderStyle(wsVers, headerStyle);

  // ─── APPORTS (entrées de fonds) ───
  const wsApports = workbook.addWorksheet("APPORTS");
  wsApports.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 15 },
    { header: "Source", key: "source", width: 20 },
    { header: "Montant", key: "montant", width: 15 },
    { header: "Référence", key: "reference", width: 18 },
    { header: "Notes", key: "notes", width: 25 },
  ];
  data.apports.forEach((a) => wsApports.addRow({ date: a.date, type: a.type, source: a.source, montant: a.montant, reference: a.reference || "", notes: a.notes || "" }));
  applyHeaderStyle(wsApports, headerStyle);

  // ─── LIVRAISONS ───
  const wsLivr = workbook.addWorksheet("LIVRAISONS");
  wsLivr.columns = [
    { header: "N° Lot", key: "numero", width: 12 },
    { header: "Date", key: "date", width: 12 },
    { header: "Fournisseur", key: "fournisseur", width: 20 },
    { header: "Kg", key: "kg", width: 10 },
    { header: "Prix", key: "prix", width: 12 },
  ];
  data.livraisons.forEach((l) => wsLivr.addRow({ numero: l.numero, date: l.date, fournisseur: l.fournisseur, kg: l.kg, prix: l.prix }));
  applyHeaderStyle(wsLivr, headerStyle);

  // ─── EMBALLAGES ───
  const wsEmb = workbook.addWorksheet("EMBALLAGES");
  wsEmb.columns = [
    { header: "N° Lot", key: "numeroLot", width: 12 },
    { header: "Date", key: "date", width: 12 },
    { header: "Nb Cartons", key: "nombreCartons", width: 12 },
    { header: "Prix/carton", key: "prixParCarton", width: 12 },
    { header: "Total", key: "total", width: 15 },
  ];
  data.emballages.forEach((e) => wsEmb.addRow({ numeroLot: e.numeroLot, date: e.date, nombreCartons: e.nombreCartons, prixParCarton: e.prixParCarton, total: e.total }));
  applyHeaderStyle(wsEmb, headerStyle);

  // ─── MAINTENANCE ───
  const wsMaint = workbook.addWorksheet("MAINTENANCE");
  wsMaint.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 12 },
    { header: "Équipement", key: "equipement", width: 20 },
    { header: "Description", key: "description", width: 25 },
    { header: "Coût", key: "cout", width: 12 },
    { header: "Prochaine", key: "prochaine", width: 12 },
  ];
  data.maintenance.forEach((m) => wsMaint.addRow({ date: m.date, type: m.type, equipement: m.equipement, description: m.description, cout: m.cout, prochaine: m.prochaine || "" }));
  applyHeaderStyle(wsMaint, headerStyle);

  // ─── VEHICULES ───
  const wsVeh = workbook.addWorksheet("VEHICULES");
  wsVeh.columns = [
    { header: "Nom", key: "nom", width: 20 },
    { header: "Chauffeur", key: "chauffeur", width: 20 },
    { header: "Km", key: "km", width: 10 },
  ];
  data.vehicules.forEach((v) => wsVeh.addRow({ nom: v.nom, chauffeur: v.chauffeur, km: v.km }));
  applyHeaderStyle(wsVeh, headerStyle);

  // ─── VEHICULE OPS ───
  const wsVehOps = workbook.addWorksheet("VEHICULE_OPS");
  wsVehOps.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Véhicule", key: "vehiculeId", width: 15 },
    { header: "Type", key: "type", width: 12 },
    { header: "Km", key: "km", width: 10 },
    { header: "Litres", key: "litres", width: 10 },
    { header: "Montant", key: "montant", width: 12 },
    { header: "Description", key: "description", width: 25 },
  ];
  data.vehiculeOps.forEach((op) => wsVehOps.addRow({ date: op.date, vehiculeId: op.vehiculeId, type: op.type, km: op.km, litres: op.litres, montant: op.montant, description: op.description }));
  applyHeaderStyle(wsVehOps, headerStyle);

  // ─── COMMERCIAUX ───
  const wsComm = workbook.addWorksheet("COMMERCIAUX");
  wsComm.columns = [
    { header: "Nom", key: "nom", width: 20 },
    { header: "Téléphone", key: "tel", width: 15 },
    { header: "Objectif", key: "objectif", width: 12 },
  ];
  data.commerciaux.forEach((c) => wsComm.addRow({ nom: c.nom, tel: c.tel, objectif: c.objectif || "" }));
  applyHeaderStyle(wsComm, headerStyle);

  // ─── LIVREURS ───
  const wsLivreur = workbook.addWorksheet("LIVREURS");
  wsLivreur.columns = [
    { header: "Nom", key: "nom", width: 20 },
    { header: "Téléphone", key: "tel", width: 15 },
    { header: "Objectif", key: "objectif", width: 12 },
  ];
  data.livreurs.forEach((l) => wsLivreur.addRow({ nom: l.nom, tel: l.tel, objectif: l.objectif || "" }));
  applyHeaderStyle(wsLivreur, headerStyle);

  // ─── PARAMETRES ───
  const wsParams = workbook.addWorksheet("PARAMETRES");
  wsParams.columns = [
    { header: "Paramètre", key: "param", width: 25 },
    { header: "Valeur", key: "valeur", width: 15 },
  ];
  const params = data.params;
  wsParams.addRow({ param: "Taux commission (%)", valeur: params.taux || 0 });
  wsParams.addRow({ param: "Solde ouverture", valeur: params.soldeOuverture || 0 });
  wsParams.addRow({ param: "Prix rouleau", valeur: params.prixRouleau || 0 });
  wsParams.addRow({ param: "Prix pack", valeur: params.prixPack || 0 });
  wsParams.addRow({ param: "Prix carton emballage", valeur: params.prixCarton || 0 });
  wsParams.addRow({ param: "Packs/carton", valeur: params.packsParCarton || 0 });
  wsParams.addRow({ param: "Bonus seuil", valeur: params.bonusSeuil || 0 });
  applyHeaderStyle(wsParams, headerStyle);

  // Générer le buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function applyHeaderStyle(ws: ExcelJS.Worksheet, style: Partial<ExcelJS.Style>) {
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = style.font as ExcelJS.Font;
    cell.fill = style.fill as ExcelJS.Fill;
    cell.alignment = style.alignment as Partial<ExcelJS.Alignment>;
  });
}

// Upload vers le bucket Cloud Storage par défaut du projet Firebase, sous
// backups/<fileName>. Contrairement à Google Drive, un compte de service a
// nativement les droits d'écriture sur ce bucket (facturé au projet) — pas
// de blocage de quota, pas de partage manuel à configurer.
//
// Pour le lien de téléchargement, on utilise le mécanisme de jeton propre à
// Firebase Storage (firebaseStorageDownloadTokens) plutôt qu'une URL signée
// GCS classique : cette dernière nécessite la permission IAM
// `iam.serviceAccounts.signBlob` (rôle "Service Account Token Creator"), qui
// n'est pas toujours accordée par défaut au compte d'exécution des Cloud
// Functions et peut être fastidieuse à obtenir. Le jeton Firebase donne un
// accès direct au fichier (sans expiration) sans dépendre de cette
// permission ni des règles de sécurité Storage.
async function uploadToCloudStorage(fileBuffer: Buffer, fileName: string): Promise<string> {
  const filePath = `backups/${fileName}`;
  const file = bucket.file(filePath);
  const downloadToken = randomUUID();

  await file.save(fileBuffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: {
      cacheControl: "private, max-age=0",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;

  console.log(`📁 Fichier uploadé dans Cloud Storage: ${filePath}`);
  return downloadUrl;
}
