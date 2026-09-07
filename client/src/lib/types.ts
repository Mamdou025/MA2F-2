export interface Production {
  id: string;
  numero: string;
  date: string;
  packs: number;
  producteurId?: string;
  // Traçabilité (optionnelle) : livraison(s) de rouleaux effectivement
  // consommée(s) pour ce lot, pour pouvoir remonter jusqu'au fournisseur.
  livraisonIds?: string[];
  // Rebuts de fabrication (optionnel) : sachets rejetés pendant la
  // production, distincts de la casse en stock/transport.
  rebuts?: number;
  rebutsNotes?: string;
  // Identité de la machine/ligne ayant produit ce lot (optionnel, texte libre).
  machine?: string;
  // Répartition du total "packs" de ce lot entre plusieurs producteurs ayant
  // travaillé dessus ensemble (ex: lot machine avec 2-3 opérateurs). Optionnel :
  // absent pour un lot classique (un seul producteur, via producteurId, ou
  // aucun). Quand ce tableau est renseigné, packs (le total du lot) doit
  // toujours être égal à la somme de packs de chaque entrée — voir
  // handleSave() dans ProductionSection.tsx, qui maintient cette somme
  // automatiquement. packsProducteurPeriode() dans helpers.ts additionne ce
  // détail ET producteurId pour les totaux "par producteur" (objectifs,
  // production du jour) — sans ça, la contribution d'un producteur à un lot
  // partagé serait invisible dans son suivi individuel.
  producteurs?: { producteurId: string; packs: number }[];
}

export interface Vente {
  id: string;
  numero: string;
  date: string;
  client: string;
  commercial: string;
  packs: number;
  prix: number;
  mode: "Payé" | "Crédit";
  livreur: string;
  avance?: number;
  modePaiement?: string;
  bonus?: number;
  // Taux de commission (F CFA / pack) figé au moment de la vente. Sans ce
  // snapshot, la commission d'un commercial était recalculée en direct avec
  // le taux ACTUEL des Paramètres à chaque affichage — donc si le taux
  // change, tout l'historique de commission changeait rétroactivement, y
  // compris pour des ventes déjà versées. Voir commissionVente() dans
  // helpers.ts : les ventes créées avant ce champ (undefined) retombent sur
  // le taux courant pour rester compatibles avec les données existantes.
  tauxCommission?: number;
}

export interface Client {
  id: string;
  nom: string;
  type: string;
 zone: string;

  tel: string;
  prix: number;
  // Position géographique (optionnelle) : placée manuellement sur une carte
  // ou déduite par géocodage du champ "zone". Sert à visualiser et organiser
  // les clients géographiquement (carte, tournées de livraison, etc.).
  lat?: number;
  lng?: number;
  // Plafond de crédit (optionnel, en F CFA) : au-delà de ce montant total
  // d'ardoise en cours, un avertissement est affiché à la vente suivante à
  // crédit pour ce client. Non renseigné ou 0 = pas de limite.
  plafondCredit?: number;
  // Bonus exceptionnel (optionnel) : règle de bonus packs propre à ce client,
  // qui remplace le seuil global DB.params.bonusSeuil pour ses ventes. Ex:
  // { seuil: 20, packsBonus: 3 } = 3 packs offerts par tranche de 20 packs
  // achetés (au lieu du bonus standard 1 pack / bonusSeuil packs). Voir
  // calculerBonusVente() dans helpers.ts.
  bonusExceptionnel?: { seuil: number; packsBonus: number };
}

// Commande client prise par téléphone : capture l'appel (heure, qui a répondu)
// et les informations de livraison AVANT que la vente ne soit finalisée sur le
// terrain. Sert de carnet de commandes pour organiser les tournées de livraison
// (quel livreur, quelle zone, quel jour), distinct de Vente qui n'enregistre
// que la transaction déjà effectuée. Une commande peut être liée après coup à
// la Vente qui en a résulté (venteId), une fois livrée et encaissée — pas de
// conversion automatique, ce rapprochement reste manuel pour l'instant.
export interface Commande {
  id: string;
  numero: string;
  // Date de saisie de la commande (YYYY-MM-DD), capturée automatiquement à la
  // création, verrouillée au même titre que heureAppel ci-dessous depuis le
  // 2026-08-22 (auparavant modifiable via un <input type="date">, ce qui a
  // permis à une commande de se retrouver avec une date de saisie postérieure
  // à son propre départ/sa propre livraison déjà enregistrés — voir CMD-150 —
  // d'où l'ajout du même verrouillage qu'heureAppel plutôt que de se
  // contenter du garde-fou de validation dans handleSave).
  date: string;
  // Heure de saisie de la commande (HH:mm), capturée automatiquement à la
  // création — point de départ du suivi de délai avant livraison, distinct de
  // l'heure de livraison prévue/effective. Corrigé le 2026-08-22 : ce champ
  // était auparavant un <input type="time"> librement modifiable ("heure
  // d'appel"), ce qui laissait des heures incohérentes/futures être saisies
  // par erreur (ex: une commande du jour affichant une heure plus tardive que
  // l'heure actuelle). Il est désormais verrouillé côté formulaire
  // (CommandesSection.tsx, non éditable) et fixé à l'heure système exacte du
  // clic sur "Enregistrer" pour une nouvelle commande ; une fois enregistré,
  // il ne change plus, y compris en modifiant la commande ensuite. Les
  // commandes déjà saisies avant ce correctif gardent leur heure telle
  // quelle (non corrigées rétroactivement, sur demande explicite de
  // l'utilisateur).
  heureAppel: string;
  // Client existant (optionnel) : si renseigné, nom/tel/zone sont pré-remplis
  // depuis la fiche Client mais restent modifiables pour un appel ponctuel
  // (ex: adresse de livraison différente de la zone habituelle du client).
  clientId?: string;
  client: string;
  tel: string;
  // Zone/commune de livraison (liste communesDakar.ts, comme Client.zone).
  zone: string;
  // Précision d'adresse en texte libre (repère, numéro de porte, étage...).
  adresseDetail?: string;
  packs: number;
  // Qui a pris l'appel / enregistré la commande (texte libre ou nom d'un commercial).
  commercial?: string;
  // Livreur assigné à cette commande (id d'un Livreur), pour organiser la tournée.
  livreurId?: string;
  dateLivraisonPrevue?: string;
  heureLivraisonPrevue?: string;
  notes?: string;
  statut: "en_attente" | "assignee" | "en_livraison" | "livree" | "annulee";
  venteId?: string;
  // Horodatage ISO exact du passage au statut "livree" (capturé automatiquement
  // dans CommandesSection.tsx, comme ReconciliationRecord.reconcilieLe). Sert
  // uniquement au suivi retard/à-l'heure (comparé à dateLivraisonPrevue +
  // heureLivraisonPrevue) — n'existe pas sur les commandes livrées avant
  // l'ajout de ce champ (2026-08-13), donc toujours vérifier sa présence
  // avant de calculer un retard.
  livreeLe?: string;
  // Horodatage ISO exact du passage au statut "en_livraison" (capturé
  // automatiquement dans CommandesSection.tsx, même principe que livreeLe) —
  // l'heure de départ effective du livreur pour cette commande. N'existe pas
  // sur les commandes passées "en livraison" avant l'ajout de ce champ
  // (2026-08-14), donc toujours vérifier sa présence avant de l'utiliser.
  enLivraisonLe?: string;
}

export interface Commercial {
  id: string;
  nom: string;
  tel: string;
  objectif?: number;
}

export interface Livreur {
  id: string;
  nom: string;
  tel: string;
  date?: string;
  objectif?: number;
  // Camion actuellement conduit par ce livreur (id d'un Vehicule). Sert à
  // savoir de quel emplacement de stock ("camion_<vehiculeId>") déduire les
  // ventes effectuées par ce livreur — voir VentesSection.tsx. Sans ce
  // champ, les ventes déduisaient à tort le stock d'un emplacement fictif
  // "camion_<id du livreur>" qui n'était jamais alimenté par les
  // chargements (ceux-ci créditent "camion_<id du VEHICULE>"), ce qui
  // rendait tous les soldes camions négatifs et le stock usine surévalué.
  // Voir CLAUDE.md "Bug stock camions" pour l'historique complet.
  vehiculeId?: string;
  // Capacité de livraison de ce camion en nombre de packs (optionnel). Utilisée
  // uniquement par le dispatching automatique des commandes (voir
  // dispatching.ts / CommandesSection.tsx) pour ne pas surcharger un camion —
  // sans effet ailleurs dans l'app si elle n'est pas renseignée.
  capacitePacks?: number;
}

export interface Producteur {
  id: string;
  nom: string;
  tel: string;
  objectif?: number;
}

// Membre du personnel salarié (ne recouvre pas Commercial/Livreur, qui sont
// des rôles métier suivis séparément et peuvent aussi être salariés). Sert
// uniquement à alimenter un menu déroulant fiable à la saisie d'une dépense
// "Salaires" (DepensesSection.tsx) — avant cette rubrique, le nom de
// l'employé n'existait qu'en texte libre dans Depense.fournisseur, souvent
// laissé vide ou incohérent d'une saisie à l'autre, ce qui rendait le récap
// par employé peu fiable ("Sans nom" pour la plupart des lignes).
export interface Employe {
  id: string;
  nom: string;
  tel?: string;
  poste?: string;
  // Salaire mensuel de référence (optionnel, informatif) — n'est PAS utilisé
  // pour calculer automatiquement les dépenses "Salaires" : chaque paiement
  // (salaire mensuel ou avance) reste saisi manuellement dans Dépenses.
  salaireBase?: number;
  actif: boolean;
}

// Rubrique Actionnaires (2026-09-06) : registre des actionnaires/associés de
// l'entreprise, distinct de Employés/Commerciaux/Livreurs (ce ne sont pas
// des rôles opérationnels). Sert uniquement à alimenter le menu déroulant
// des mouvements financiers ci-dessous (MouvementActionnaire) — aucun lien
// avec les comptes de connexion (AppUser/users).
export interface Actionnaire {
  id: string;
  nom: string;
  tel?: string;
  // Pourcentage de parts détenues, informatif uniquement (aucun calcul ne
  // s'appuie dessus pour l'instant — sert juste d'aide-mémoire à l'écran).
  pourcentageParts?: number;
  notes?: string;
  actif: boolean;
}

// Mouvement financier lié à un actionnaire : un "Déblocage" est de l'argent
// mis PAR l'actionnaire DANS l'entreprise (apport/appel de fonds répondu),
// un "Dividende" est de l'argent versé PAR l'entreprise À l'actionnaire
// (distribution de bénéfice). Volontairement un registre séparé, sans effet
// sur le solde de caisse (computeSoldeCaisseActuel dans helpers.ts) ni sur
// Apports/Versements/Dépenses — décision explicite de l'utilisateur pour ne
// pas toucher ce calcul déjà sensible ; voir CLAUDE.md "Rubrique
// Actionnaires" pour le détail.
export type TypeMouvementActionnaire = "Déblocage" | "Dividende";

export interface MouvementActionnaire {
  id: string;
  date: string;
  actionnaireId: string;
  type: TypeMouvementActionnaire;
  montant: number;
  reference?: string;
  notes?: string;
}

export interface Depense {
  id: string;
  date: string;
  categorie: string;
  libelle: string;
  fournisseur: string;
  montant: number;
  mode?: string;
  notes?: string;
  // Lien vers l'Employé sélectionné dans le menu déroulant, uniquement pour
  // les dépenses de catégorie "Salaires" (salaire mensuel ou avance sur
  // salaire — les deux restent dans cette même catégorie, voir
  // DepensesSection.tsx). Absent sur les dépenses créées avant l'ajout de la
  // rubrique Employés, ou saisies en texte libre via Depense.fournisseur.
  employeId?: string;
}

export interface Recouvrement {
  id: string;
  venteId?: string;
  numeroBL?: string;
  client: string;
  date: string;
  montant: number;
  mode: string;
  notes: string;
}

export interface Livraison {
  id: string;
  numero: string;
  date: string;
  fournisseur: string;
  kg: number;
  prix: number;
  modePaiement?: "cash" | "credit";
  datePaiement?: string;
  // Commande vs réception : quantité/prix convenus au moment de la commande,
  // pour détecter un écart avec ce qui est effectivement reçu (optionnel,
  // renseigné seulement si un accord préalable existait).
  kgCommande?: number;
  prixKgCommande?: number;
  // Contrôle qualité à la réception (optionnel).
  qualiteConforme?: boolean;
  quantiteRejetee?: number;
  qualiteNotes?: string;
}
export interface Emballage {
  id: string;
  numeroLot: string;
  date: string;
  nombreCartons: number;
  prixParCarton: number;
  total: number;
  modePaiement?: "cash" | "credit";
  datePaiement?: string;
}

export interface Maintenance {
  id: string;
  date: string;
  type: string;
  equipement: string;
  description: string;
  cout: number;
  prochaine: string;
  // Impact sur la production (optionnel) : cette intervention a-t-elle
  // provoqué un arrêt machine, et quelle production a été perdue de ce fait.
  arret?: boolean;
  dureeArretHeures?: number;
  packsPerdusEstimes?: number;
  // Id de la dépense créée automatiquement à l'enregistrement de cette
  // intervention (si cout > 0) — permet de la supprimer en cascade si
  // l'intervention est supprimée. Absent sur les interventions créées
  // avant l'ajout de ce champ.
  depenseId?: string;
}

export interface Versement {
  id: string;
  date: string;
  type: string;
  beneficiaire: string;
  montant: number;
  notes: string;
}

// Entrée de fonds hors ventes/recouvrements : apport en capital, appel de fonds
// répondu par MA2F ou un associé, subvention, etc. Contrairement aux Versements
// (qui sont toujours des sorties de caisse), un Apport est toujours une entrée.
export interface Apport {
  id: string;
  date: string;
  type: string;
  source: string;
  montant: number;
  reference: string;
  notes: string;
}

// Intention de paiement mobile money (Wave) — créée et confirmée uniquement
// côté serveur (cloud-functions/src/index.ts : createWaveCheckoutSession /
// waveWebhook). Le client ne fait que lire cette collection en temps réel
// pour afficher le statut ; voir firestore.rules (write: if false).
export interface MobileMoneyIntent {
  id: string;
  provider: "wave";
  venteId?: string;
  numeroBL?: string;
  clientId?: string;
  client: string;
  montant: number;
  statut: "en_attente" | "confirme" | "echoue";
  waveSessionId?: string;
  waveCheckoutUrl?: string;
  recouvrementId?: string;
}

export interface Vehicule {
  id: string;
  nom: string;
  // Optionnel depuis le 2026-08-18 : ce champ texte libre n'est plus renseigné
  // à la création (VehiculesSection.tsx) depuis que Livreur.vehiculeId est
  // devenu la seule source de vérité pour l'assignation camion/chauffeur (voir
  // "Bug stock camions" dans CLAUDE.md). Conservé en lecture uniquement comme
  // repli d'affichage pour les véhicules créés avant ce changement
  // (StockSection.tsx, ExportExcel.tsx) — ne plus l'écrire dans du code neuf.
  chauffeur?: string;
  km: number;
  // Identifiant du boîtier GPS physique installé dans ce camion (IMEI du
  // traceur, ou "device id" côté plateforme de tracking — Traccar ou autre),
  // saisi une fois le boîtier posé (VehiculesSection.tsx). Fait le lien entre
  // les positions reçues par le webhook GPS générique
  // (cloud-functions/src/index.ts, recevoirPositionVehicule) et ce Vehicule —
  // voir positionsVehicules/{vehiculeId} et "Suivi GPS temps réel des
  // camions" dans CLAUDE.md. Optionnel : sans ce champ, aucune position n'est
  // reçue/affichée pour ce camion (le webhook rejette avec 404 tout
  // traceurId qui ne correspond à aucun Vehicule.traceurId).
  traceurId?: string;
}

// Dernière position GPS connue d'un camion, rapportée par un boîtier GPS
// physique installé dedans (PAS le téléphone du livreur — cette fonctionnalité-
// là n'existe pas encore, voir "Maps/geolocation" dans CLAUDE.md). Écrite
// EXCLUSIVEMENT par la Cloud Function recevoirPositionVehicule
// (cloud-functions/src/index.ts) via le SDK Admin — aucune écriture cliente
// n'est autorisée (voir firestore.rules, même principe que
// MobileMoneyIntent/mobileMoneyIntents ci-dessus). Un seul document par
// véhicule (id Firestore = Vehicule.id), écrasé à chaque nouvelle position
// reçue : ce n'est PAS un historique/trajet, juste le dernier point connu —
// voir le commentaire dans SuiviLogistiqueSection.tsx si un relevé de trace
// est voulu plus tard (nécessiterait une sous-collection à part, volontairement
// pas construite tant que le besoin n'est pas confirmé).
export interface PositionVehicule {
  id: string; // = Vehicule.id
  vehiculeId: string;
  lat: number;
  lng: number;
  vitesseKmH?: number | null;
  capDegres?: number | null; // cap/direction, 0-360, si le boîtier le transmet
  // Horodatage ISO de la position tel que rapporté par le boîtier/la
  // plateforme (peut différer de _receivedAt si transmis avec délai) — absent
  // si la source ne le fournit pas, auquel cas _receivedAt fait foi pour la
  // fraîcheur affichée dans SuiviLogistiqueSection.tsx.
  horodatage?: string | null;
}

export interface VehiculeOp {
  id: string;
  vehiculeId: string;
  date: string;
  type: string;
  km: number;
  litres: number;
  montant: number;
  description: string;
}

export interface CorbeilleItem {
  id: string;
  originalType: string;
  moduleName: string;
  desc: string;
  deletedAt: string;
  deletedBy: string;
  data: any;
  // Mouvements de stock liés à l'élément supprimé, à restaurer en même temps que lui
  relatedMouvements?: any[];
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  type: string;
  module: string;
  details: string;
  userName: string;
  device: string;
  ip: string;
}

export interface AppUser {
  id: string;
  nom: string;
  login: string;
  email?: string;
  tel?: string;
  roles: string[];
  role: string;
  actif: boolean;
  allowedSections?: string[];
}

export interface Backup {
  id: string;
  date: string;
  type: string;
  taille: number;
  // Format historique (avant le correctif du 2026-09-04) : le JSON complet de
  // la sauvegarde était écrit directement dans ce champ, dans le document
  // Firestore `backups/<id>` — abandonné car ça dépasse la limite de 1 Mo par
  // document Firestore une fois la base assez grosse (c'est ce qui a
  // silencieusement bloqué toute sauvegarde restaurable depuis le 2026-08-06).
  // Conservé optionnel uniquement pour que les sauvegardes déjà existantes à
  // cette date restent lisibles/restaurables (voir getBackupData dans
  // BackupsSection.tsx).
  data?: string;
  // Format actuel (depuis le 2026-09-04) : le JSON est uploadé sur Firebase
  // Storage (voir BackupsSection.tsx) et seul ce chemin est gardé ici — le
  // document Firestore `backups/<id>` ne fait alors que quelques centaines
  // d'octets, très loin de la limite de 1 Mo.
  storagePath?: string;
}

export interface ClotureInfo {
  date: string;
  clotureePar: string;
  clotureeLe: string;
  soldeJour: number;
  totalEntrees: number;
  totalSorties: number;
  totalVentes: number;
  totalProduction: number;
  // Clôture caisse améliorée
  montantAttendu?: number;       // Argent attendu en caisse (calculé)
  montantCompte?: number;        // Argent réellement compté
  ecartCaisse?: number;          // Écart = compté - attendu
  explicationEcart?: string;     // Explication si écart
  verrouille?: boolean;          // Transactions verrouillées après clôture
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  module: string;
  action: "create" | "update" | "delete";
  entityId: string;
  entityLabel: string;
  userName: string;
  motif?: string;
  changes: {
    field: string;
    oldValue: string;
    newValue: string;
  }[];
}

// Rappel/message interne envoyé par un admin à un compte caissier/commercial
// précis (ex: relancer un commercial sur une créance client importante,
// added 2026-08-21). Distinct de JournalEntry (trace technique système
// générée automatiquement par l'app) et de HistoryEntry (audit des
// modifications d'une entité métier) : une Notification est un message
// adressé volontairement à UNE personne, avec un état lu/non-lu propre.
// `destinataireEmail` (et non un id) identifie le destinataire, car c'est le
// seul identifiant stable partagé entre AppUser.email et le claim
// `request.auth.token.email` du token Firebase — AppUser.id est un nanoid
// généré côté client (voir loadUserProfile dans AppContext.tsx), sans lien
// avec l'uid Firebase Auth, donc inutilisable pour une règle Firestore côté
// serveur qui doit vérifier "ce destinataire marque son propre message
// comme lu" (voir firestore.rules, match /notifications/{docId}).
export interface Notification {
  id: string;
  destinataireEmail: string;
  destinataireNom: string;
  // Rôle du destinataire au moment de l'envoi (dénormalisé, affichage
  // uniquement — ex: badge "→ Caissier" dans NotificationBell.tsx).
  destinataireRole: string;
  expediteurNom: string;
  expediteurEmail: string;
  message: string;
  // Contexte optionnel (ex: rappel de créance depuis CreancesSection.tsx) —
  // purement informatif, pas de référence vive vers Client/Vente pour rester
  // simple (si le client/la vente est modifié(e) après coup, ce texte reste
  // celui du moment de l'envoi, ce qui est le comportement voulu pour un
  // rappel : "c'était l'état au moment où j'ai relancé").
  clientNom?: string;
  montant?: number;
  date: string; // ISO
  lu: boolean;
  luLe?: string;
}

// Palier de prime sur objectif (voir "Plan de motivation — Livreurs &
// Commerciaux", août 2026). `seuilPct` = % de l'objectif mensuel à atteindre
// pour déclencher ce palier (ex: 80, 100, 120) ; `montant` = prime fixe en F
// CFA versée si ce palier (et lui seul, le plus haut atteint) est atteint.
// Les paliers sont évalués du plus haut au plus bas — voir
// computePalierAtteint()/computePrimeMontant() dans helpers.ts.
export interface PalierPrime {
  label: string;
  seuilPct: number;
  montant: number;
}

export interface DBParams {
  taux: number;
  tauxSachetsParKg: number;
  soldeOuverture: number;
  prixRouleau: number;
  prixPack: number;
  prixCarton: number;
  packsParCarton: number;
  bonusSeuil: number;
  autoBackup?: boolean;
  objectifProductionMensuel?: number;
  clotures?: ClotureInfo[];
  // Liste plate des dates "YYYY-MM-DD" verrouillées, dérivée de clotures[]
  // ci-dessus — c'est le champ que firestore.rules teste (durci 2026-08-29)
  // pour refuser une écriture directe sur ventes/depenses/production/
  // recouvrements/versements/apports/mouvements_stock d'une journée
  // clôturée. Maintenue par createCloture/annulerCloture (lib/cloture.ts)
  // et par cloturerCaisse/annulerCloture (cloud-functions/src/index.ts) —
  // toujours recalculée depuis clotures[], jamais éditée à la main.
  clotureesDates?: string[];
  analytique?: {
    sachet?: number;
    eau?: number;
    energie?: number;
    salaires?: number;
    maintenance?: number;
    autres?: number;
    base?: number;
  };
  // Grille de primes sur objectif mensuel — configurable par un admin dans
  // ObjectifsSection.tsx. Un jeu de paliers pour les commerciaux (basé sur le
  // CA du mois vs Commercial.objectif) et un pour les livreurs (basé sur les
  // packs livrés du mois vs Livreur.objectif). Optionnel : si absent,
  // DEFAULT_PALIERS_* dans helpers.ts sert de valeur par défaut à l'affichage
  // (sans être persisté tant qu'un admin ne les modifie pas).
  primesPaliers?: {
    commercial: PalierPrime[];
    livreur: PalierPrime[];
  };
  // Budget mensuel par catégorie de dépense (F CFA), configurable dans
  // Paramètres — voir Etude-Depenses-AquaSachet.docx §4.2 ("pilotage
  // budgétaire"). Une catégorie absente de cet objet n'a simplement pas de
  // budget suivi (pas d'alerte). Comparé au total du MOIS EN COURS (flux,
  // pas cumulé) pour chaque catégorie dans DepensesSection.tsx, pour
  // afficher une alerte visuelle dès que le total dépasse le budget —
  // anticiper une dérive au lieu de la constater a posteriori dans le
  // résultat global (constat de l'étude).
  budgetsDepenses?: Record<string, number>;
  // Seuil (F CFA) au-delà duquel une nouvelle dépense doit passer par le
  // circuit d'approbation (voir approvalWorkflow.ts / ApprobationsSection.tsx)
  // au lieu d'être enregistrée immédiatement — même proposition de l'étude,
  // réutilisant le mécanisme de double contrôle déjà en place pour les
  // ventes à crédit/versements. Non défini ou 0 = désactivé (comportement
  // inchangé : la dépense est enregistrée directement, comme avant l'ajout
  // de ce champ). Ne s'applique qu'aux rôles non-admin (caissier/commercial)
  // — voir DepensesSection.tsx : l'admin reste le seul approbateur possible
  // (DEFAULT_APPROVAL_CONFIG.rolesApprobateurs dans approvalWorkflow.ts),
  // donc ses propres dépenses ne pourraient jamais être approuvées par
  // quelqu'un d'autre si elles passaient aussi par ce circuit.
  seuilApprobationDepense?: number;
}

// Contrôle de stock usine : comptage physique périodique comparé au stock
// théorique calculé depuis le journal de mouvements (production - ventes -
// chargements + retours - casse - ajustements). Permet de détecter un vol ou
// une erreur de saisie avant qu'il ne s'accumule sur plusieurs semaines.
export interface StockControle {
  id: string;
  date: string;
  produit: "sachet_plein" | "rouleau_plastique";
  emplacement: string; // "usine" en pratique, mais laissé libre pour extension future
  stockTheorique: number;
  stockCompte: number;
  unite: "packs" | "kg";
  ecart: number; // compté - théorique
  comptePar: string;
  compteLe: string;
  explicationEcart?: string;
}

export interface ReconciliationRecord {
  id: string;
  date: string;
  livreurId: string;
  livreurNom: string;
  vehiculeId?: string;
  vehiculeNom?: string;
  stockDepart: number;
  ventesEffectuees: number;
  retours: number;
  casse: number;
  donPolice: number;
  encaissements: number;
  creditCree: number;
  ecart: number;
  ecartMontant: number;
  statut: "ok" | "ecart" | "non_reconcilie";
  explication?: string;
  reconciliePar?: string;
  reconcilieLe?: string;
}

export interface Database {
  production: Production[];
  ventes: Vente[];
  commandes: Commande[];
  clients: Client[];
  commerciaux: Commercial[];
  livreurs: Livreur[];
  producteurs: Producteur[];
  employes: Employe[];
  actionnaires: Actionnaire[];
  mouvementsActionnaires: MouvementActionnaire[];
  depenses: Depense[];
  livraisons: Livraison[];
  emballages: Emballage[];
  recouvrements: Recouvrement[];
  avances: any[];
  maintenance: Maintenance[];
  versements: Versement[];
  apports: Apport[];
  corbeille: CorbeilleItem[];
  vehicules: Vehicule[];
  vehiculeOps: VehiculeOp[];
  backups: Backup[];
  journal: JournalEntry[];
  history: HistoryEntry[];
  notifications: Notification[];
  mouvementsStock: any[];
  // Mouvements archivés lors d'une "réinitialisation du stock" (nouveau
  // départ) — voir creerMouvementOuverture() dans lib/stock.ts et le bouton
  // "Nouveau départ" dans StockSection.tsx. Conservés en lecture seule pour
  // l'audit/consultation, mais exclus du calcul du stock actuel
  // (calculerStockParEmplacement ne lit que DB.mouvementsStock).
  mouvementsStockArchive?: any[];
  reconciliations: ReconciliationRecord[];
  stockControles: StockControle[];
  users: AppUser[];
  approvals: any[];
  auditChain: any[];
  params: DBParams;
}

export interface CurrentUser {
  nom: string;
  email: string;
  roles: string[];
  role: string;
  uid: string;
  actif: boolean;
}

export type Section =
  | "dashboard"
  | "production"
  | "ventes"
  | "commandes"
  | "clients"
  | "commerciaux"
  | "livreurs"
  | "producteurs"
  | "employes"
  | "actionnaires"
  | "depenses"
  | "caisse"
  | "creances"
  | "recouvrement"
  | "livraisons"
  | "maintenance"
  | "versements"
  | "apports"
  | "analytique"
  | "vehicules"
  | "corbeille"
  | "rapport"
  | "journal"
  | "securite"
  | "backups"
  | "utilisateurs"
  | "parametres"
  | "cloture"
  | "historique"
  | "stock"
  | "reconciliation"
  | "suiviLogistique"
  | "approbations"
  | "comptabilite"
  | "monitoring"
  | "strategie"
  | "objectifs";
