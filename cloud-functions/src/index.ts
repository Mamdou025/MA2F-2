/**
 * Cloud Functions Firebase — MA2F AquaSachet
 * Architecture Phase 2 : 1 document = 1 entité
 *
 * Validation côté serveur, transactions atomiques, custom claims.
 * Déploiement : cd cloud-functions && npm install && npm run build && firebase deploy --only functions
 *
 * STATUT DE DÉPLOIEMENT : ce dossier est déployé en production comme codebase
 * `roles-validation` (voir firebase.json). Le client (cfValidateVente,
 * checkCloudFunctionsAvailability) reste conçu pour fonctionner sans ces
 * fonctions en cas d'indisponibilité — il bascule alors sur la validation
 * locale — mais en fonctionnement normal, la validation stricte côté serveur
 * et les custom claims de rôle passent bien par ici.
 */
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

admin.initializeApp();
const db = admin.firestore();

// ─── Collections (Phase 2) ───────────────────────────────────────────────────
const COLLECTIONS = {
  ventes: "ventes",
  clients: "clients",
  production: "production",
  depenses: "depenses",
  recouvrements: "recouvrements",
  mouvementsStock: "mouvements_stock",
  journal: "journal",
  history: "history",
  reconciliations: "reconciliations",
  users: "users",
  auditLog: "audit_log",
  backups: "backups_auto",
  params: "params",
  meta: "meta",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertAuthenticated(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Connexion requise.");
  }
}

function assertAdmin(context: functions.https.CallableContext): void {
  assertAuthenticated(context);
  if (context.auth!.token.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Seul un administrateur peut effectuer cette action.");
  }
}

function assertRole(context: functions.https.CallableContext, allowedRoles: string[]): void {
  assertAuthenticated(context);
  const role = context.auth!.token.role;
  if (!allowedRoles.includes(role)) {
    throw new functions.https.HttpsError("permission-denied", `Rôle requis: ${allowedRoles.join(", ")}`);
  }
}

async function isDateCloturee(date: string): Promise<boolean> {
  // Vérifier dans la collection params
  const paramsDoc = await db.collection(COLLECTIONS.params).doc("global").get();
  const paramsData = paramsDoc.data();
  const clotures = paramsData?.clotures || [];
  if (clotures.some((c: any) => c.date === date && c.verrouille !== false)) return true;

  // Fallback: vérifier dans meta (ancien format)
  const metaDoc = await db.collection(COLLECTIONS.meta).doc("data").get();
  const metaData = metaDoc.data();
  const metaClotures = metaData?.params?.clotures || [];
  return metaClotures.some((c: any) => c.date === date && c.verrouille !== false);
}

// Reconstruit la liste plate des dates verrouillées à partir du tableau
// clotures[] complet — utilisée par cloturerCaisse/annulerCloture pour tenir
// à jour params/global.clotureesDates, le seul champ que firestore.rules
// peut tester avec un simple "date in [...]" (les règles de sécurité
// Firestore ne peuvent pas itérer sur un tableau d'objets hétérogènes pour y
// chercher un champ précis — voir le commentaire en tête de firestore.rules,
// durci le 2026-08-29). Recalculée en entier à chaque appel : donc
// auto-réparatrice pour toute journée touchée par une clôture/annulation
// après ce déploiement, même si clotureesDates avait dérivé de clotures[]
// pour une raison quelconque.
function computeClotureesDates(clotures: any[]): string[] {
  const dates = new Set<string>();
  for (const c of clotures || []) {
    if (c && typeof c.date === "string" && c.verrouille !== false) dates.add(c.date);
  }
  return Array.from(dates);
}

async function logAudit(context: functions.https.CallableContext, action: string, module: string, details: string, entityId?: string) {
  await db.collection(COLLECTIONS.auditLog).add({
    action,
    module,
    entityId: entityId || null,
    details,
    userId: context.auth!.uid,
    userEmail: context.auth!.token.email || "",
    userRole: context.auth!.token.role || "unknown",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ============================================================
// 1. CRÉATION UTILISATEUR AVEC RÔLE (Custom Claims)
// ============================================================
export const createUserWithRole = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  const { email, displayName, role, roles, tel } = data;
  if (!email || !displayName || !role) {
    throw new functions.https.HttpsError("invalid-argument", "Email, nom et rôle sont requis.");
  }

  const validRoles = ["admin", "caissier", "commercial", "lecteur"];
  if (!validRoles.includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", `Rôle invalide. Rôles autorisés: ${validRoles.join(", ")}`);
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      displayName,
      emailVerified: false,
    });
  } catch (e: any) {
    if (e.code === "auth/email-already-exists") {
      // Le compte Firebase Auth existe déjà (ex: créé avant ce correctif, ou
      // via la Console) — on n'échoue pas silencieusement : on récupère son
      // uid et on applique quand même le rôle demandé, pour rester
      // idempotent avec setUserClaims.
      const existing = await admin.auth().getUserByEmail(email);
      const userRoles = roles && Array.isArray(roles) ? roles : [role];
      await admin.auth().setCustomUserClaims(existing.uid, { role, roles: userRoles });
      await db.collection(COLLECTIONS.users).doc(existing.uid).set(
        {
          uid: existing.uid,
          email,
          nom: displayName,
          tel: tel || "",
          role,
          roles: userRoles,
          actif: true,
          _updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          _updatedBy: context.auth!.uid,
        },
        { merge: true }
      );
      const resetLink = await admin.auth().generatePasswordResetLink(email);
      await logAudit(context, "update", "users", `Compte existant relié + rôle appliqué (${role})`, existing.uid);
      return {
        uid: existing.uid,
        email,
        resetLink,
        message: `Un compte Firebase existait déjà pour ${email} : rôle ${role} appliqué.`,
        alreadyExisted: true,
      };
    }
    throw new functions.https.HttpsError("internal", e.message || "Erreur création du compte Firebase Authentication.");
  }

  const userRoles = roles && Array.isArray(roles) ? roles : [role];
  await admin.auth().setCustomUserClaims(userRecord.uid, { role, roles: userRoles });

  const resetLink = await admin.auth().generatePasswordResetLink(email);

  await db.collection(COLLECTIONS.users).doc(userRecord.uid).set({
    uid: userRecord.uid,
    email,
    nom: displayName,
    tel: tel || "",
    role,
    roles: userRoles,
    actif: true,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _createdBy: context.auth!.uid,
    _version: 1,
  });

  await logAudit(context, "create", "users", `Utilisateur ${displayName} (${role}) créé`, userRecord.uid);

  return { uid: userRecord.uid, email, resetLink, message: `Utilisateur ${displayName} créé avec le rôle ${role}` };
});

// ============================================================
// 2. MISE À JOUR DES CLAIMS UTILISATEUR
// ============================================================
export const setUserClaims = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  let { uid, email, role, roles } = data;
  if ((!uid && !email) || !role) {
    throw new functions.https.HttpsError("invalid-argument", "UID ou email, et rôle, requis.");
  }

  const validRoles = ["admin", "caissier", "commercial", "lecteur"];
  if (!validRoles.includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", `Rôle invalide.`);
  }

  // Beaucoup de comptes créés avant l'ajout de createUserWithRole n'ont
  // jamais de `uid` Firebase Auth enregistré côté client (seule la donnée
  // locale users/{id} existe) — dans ce cas on résout le compte par email.
  // C'était la cause réelle des erreurs "Missing or insufficient permissions" :
  // le rôle changeait dans l'app mais le custom claim du token Firebase,
  // seul élément vérifié par firestore.rules, n'était jamais mis à jour.
  if (!uid) {
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      uid = userRecord.uid;
    } catch (e: any) {
      throw new functions.https.HttpsError(
        "not-found",
        `Aucun compte Firebase Authentication trouvé pour ${email}. L'utilisateur doit d'abord se connecter au moins une fois, ou être recréé via "Nouvel utilisateur".`
      );
    }
  }

  const userRoles = roles && Array.isArray(roles) ? roles : [role];
  await admin.auth().setCustomUserClaims(uid, { role, roles: userRoles });

  // set(..., merge) plutôt que update() : le document users/{uid} peut ne
  // pas encore exister pour un compte créé avant createUserWithRole. On en
  // profite pour y écrire `uid`, afin que les prochains appels puissent à
  // nouveau se baser dessus sans repasser par une résolution email.
  await db.collection(COLLECTIONS.users).doc(uid).set(
    {
      uid,
      ...(email ? { email } : {}),
      role,
      roles: userRoles,
      _updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _updatedBy: context.auth!.uid,
    },
    { merge: true }
  );

  await logAudit(context, "update", "users", `Claims mis à jour: ${role}`, uid);
  return { uid, message: `Claims mis à jour pour ${uid}` };
});

// ============================================================
// 3. DÉSACTIVER / RÉACTIVER UN UTILISATEUR
// ============================================================
export const toggleUserStatus = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  const { uid, actif } = data;
  if (!uid || actif === undefined) {
    throw new functions.https.HttpsError("invalid-argument", "UID et statut requis.");
  }

  await admin.auth().updateUser(uid, { disabled: !actif });
  await db.collection(COLLECTIONS.users).doc(uid).update({
    actif,
    _updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await logAudit(context, "update", "users", actif ? "Réactivé" : "Désactivé", uid);
  return { message: actif ? "Utilisateur réactivé" : "Utilisateur désactivé" };
});

// ============================================================
// 4. TRIGGER: Initialiser les claims au premier login
// ============================================================
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  // Ne jamais écraser un rôle déjà posé par createUserWithRole (qui appelle
  // admin.auth().createUser() puis setCustomUserClaims() dans la même
  // exécution) — ce trigger onCreate se déclenche de façon totalement
  // indépendante et asynchrone dès la création du compte Auth, sans garantie
  // d'ordre avec le reste de createUserWithRole. En pratique, ce trigger
  // arrivait souvent APRES que le bon rôle ait été posé, et l'écrasait
  // silencieusement par "lecteur" (le cas par défaut ci-dessous) — l'app
  // continuait d'afficher le rôle correct (Firestore users/{uid}.role,
  // jamais réécrit ici si le doc existait déjà), mais toutes les écritures
  // de cet utilisateur étaient réellement bloquées par firestore.rules
  // (canWrite() lit request.auth.token.role, pas la DB locale), sans aucune
  // erreur visible pour l'utilisateur (voir saveToFirestore() côté client :
  // "Pas de popup ... l'erreur reste visible ... via le badge 'Erreur sync'
  // du menu latéral"). Symptôme observé : tout ce qu'un utilisateur nouvellement
  // créé enregistrait disparaissait au rafraîchissement de la page. On
  // resynchronise donc d'abord un état frais du compte : si un claim `role`
  // existe déjà (posé par createUserWithRole quelques instants plus tôt), on
  // ne touche à rien.
  const freshRecord = await admin.auth().getUser(user.uid);
  if (freshRecord.customClaims && freshRecord.customClaims.role) {
    return;
  }

  const ADMIN_EMAILS = ["ziza220@gmail.com"];
  const role = ADMIN_EMAILS.includes(user.email || "") ? "admin" : "lecteur";

  await admin.auth().setCustomUserClaims(user.uid, { role, roles: [role] });

  const userDoc = await db.collection(COLLECTIONS.users).doc(user.uid).get();
  if (!userDoc.exists) {
    await db.collection(COLLECTIONS.users).doc(user.uid).set({
      uid: user.uid,
      email: user.email || "",
      nom: user.displayName || user.email || "",
      role,
      roles: [role],
      actif: true,
      _createdAt: admin.firestore.FieldValue.serverTimestamp(),
      _version: 1,
    });
  }
});

// ============================================================
// 5. VALIDATION ET CRÉATION DE VENTE (Transaction atomique)
// Nom callable: "validateVente"
// ============================================================
export const validateVente = functions.https.onCall(async (data, context) => {
  assertRole(context, ["admin", "caissier", "commercial"]);

  const { clientId, clientNom, packs, prix, mode, avance, commercial, date, notes } = data;

  // Validations strictes
  if (!clientNom || typeof clientNom !== "string" || clientNom.trim() === "") {
    throw new functions.https.HttpsError("invalid-argument", "Le client est obligatoire.");
  }
  if (!packs || typeof packs !== "number" || packs <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "La quantité doit être un nombre positif.");
  }
  if (packs > 10000) {
    throw new functions.https.HttpsError("invalid-argument", "Quantité anormale (max 10 000 packs).");
  }
  if (!prix || typeof prix !== "number" || prix <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Le prix doit être un nombre positif.");
  }
  if (prix > 50000) {
    throw new functions.https.HttpsError("invalid-argument", "Prix anormalement élevé (max 50 000 F/pack).");
  }
  if (!date || typeof date !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "La date est obligatoire.");
  }
  if (!mode || !["Payé", "Crédit"].includes(mode)) {
    throw new functions.https.HttpsError("invalid-argument", "Mode de paiement invalide (Payé ou Crédit).");
  }

  const montantTotal = packs * prix;
  if (avance !== undefined && avance !== null) {
    if (avance < 0) throw new functions.https.HttpsError("invalid-argument", "L'avance ne peut pas être négative.");
    if (avance > montantTotal) throw new functions.https.HttpsError("invalid-argument", "L'avance ne peut pas dépasser le montant total.");
  }

  if (await isDateCloturee(date)) {
    throw new functions.https.HttpsError("failed-precondition", "Cette journée est clôturée.");
  }

  // Transaction atomique : créer vente + mouvement stock + audit
  const venteId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const batch = db.batch();

  // Créer la vente
  const venteRef = db.collection(COLLECTIONS.ventes).doc(venteId);
  batch.set(venteRef, {
    id: venteId,
    client: clientNom,
    clientId: clientId || "",
    packs,
    prix,
    mode,
    avance: avance || (mode === "Payé" ? montantTotal : 0),
    commercial: commercial || "",
    date,
    notes: notes || "",
    _version: 1,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _createdBy: context.auth!.uid,
    _locked: false,
  });

  // Créer le mouvement de stock (sortie)
  const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mvtRef = db.collection(COLLECTIONS.mouvementsStock).doc(mvtId);
  batch.set(mvtRef, {
    id: mvtId,
    type: "vente",
    produit: "packs",
    quantite: packs,
    emplacement: "usine",
    reference: venteId,
    date,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _createdBy: context.auth!.uid,
  });

  // Calculer commission
  let commission = 0;
  if (commercial && commercial.trim() !== "") {
    const paramsDoc = await db.collection(COLLECTIONS.params).doc("global").get();
    const params = paramsDoc.data();
    const taux = params?.taux || 50;
    commission = packs * taux;
  }

  // Audit log
  const auditRef = db.collection(COLLECTIONS.auditLog).doc();
  batch.set(auditRef, {
    action: "create",
    module: "ventes",
    entityId: venteId,
    details: `Vente ${packs} packs à ${clientNom} (${mode}) - ${montantTotal} F`,
    userId: context.auth!.uid,
    userEmail: context.auth!.token.email || "",
    userRole: context.auth!.token.role || "",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { venteId, commission, bonus: false };
});

// ============================================================
// 6. VALIDATION ET ENREGISTREMENT PAIEMENT
// Nom callable: "validatePaiement"
// ============================================================
export const validatePaiement = functions.https.onCall(async (data, context) => {
  assertRole(context, ["admin", "caissier", "commercial"]);

  const { venteId, clientId, montant, mode, date, notes } = data;

  if (!venteId || typeof venteId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "L'identifiant de vente est requis.");
  }
  if (!montant || typeof montant !== "number" || montant <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Le montant doit être un nombre positif.");
  }
  if (montant > 100000000) {
    throw new functions.https.HttpsError("invalid-argument", "Montant anormalement élevé.");
  }
  if (!date || typeof date !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "La date est obligatoire.");
  }

  if (await isDateCloturee(date)) {
    throw new functions.https.HttpsError("failed-precondition", "Cette journée est clôturée.");
  }

  // Vérifier que le montant ne dépasse pas le reste à payer
  const venteDoc = await db.collection(COLLECTIONS.ventes).doc(venteId).get();
  if (!venteDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Vente introuvable.");
  }
  const vente = venteDoc.data()!;
  const montantTotal = vente.packs * vente.prix;
  const avanceVente = vente.avance || 0;

  // Calculer les recouvrements existants
  const recouvrementsSnap = await db.collection(COLLECTIONS.recouvrements)
    .where("venteId", "==", venteId)
    .get();
  let totalRecouvrements = 0;
  recouvrementsSnap.forEach((doc) => {
    totalRecouvrements += doc.data().montant || 0;
  });

  const resteAPayer = montantTotal - avanceVente - totalRecouvrements;
  if (montant > resteAPayer + 1) {
    throw new functions.https.HttpsError("invalid-argument", `Le montant (${montant} F) dépasse le reste à payer (${resteAPayer} F).`);
  }

  // Transaction atomique : créer recouvrement + audit
  const recId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const batch = db.batch();

  const recRef = db.collection(COLLECTIONS.recouvrements).doc(recId);
  batch.set(recRef, {
    id: recId,
    venteId,
    client: vente.client,
    clientId: clientId || vente.clientId || "",
    montant,
    mode: mode || "Espèces",
    date,
    notes: notes || "",
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _createdBy: context.auth!.uid,
    _locked: true, // Immuable dès la création
  });

  const auditRef = db.collection(COLLECTIONS.auditLog).doc();
  batch.set(auditRef, {
    action: "create",
    module: "recouvrements",
    entityId: recId,
    details: `Paiement ${montant} F pour vente ${venteId} (${vente.client})`,
    userId: context.auth!.uid,
    userEmail: context.auth!.token.email || "",
    userRole: context.auth!.token.role || "",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  const nouveauReste = resteAPayer - montant;
  return { recouvrementId: recId, resteAPayer: nouveauReste };
});

// ============================================================
// 7. CLÔTURE DE CAISSE
// Nom callable: "cloturerCaisse"
// ============================================================
export const cloturerCaisse = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  const { date, montantCompte, explicationEcart } = data;
  if (!date || typeof date !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Date requise.");
  }
  if (montantCompte === undefined || montantCompte === null || montantCompte < 0) {
    throw new functions.https.HttpsError("invalid-argument", "Montant compté invalide.");
  }

  if (await isDateCloturee(date)) {
    throw new functions.https.HttpsError("already-exists", "Cette journée est déjà clôturée.");
  }

  // Calculer le solde attendu pour cette date
  // Entrées: ventes payées + avances + recouvrements
  const ventesSnap = await db.collection(COLLECTIONS.ventes).where("date", "==", date).get();
  let totalEntrees = 0;
  ventesSnap.forEach((doc) => {
    const v = doc.data();
    totalEntrees += v.avance || (v.mode === "Payé" ? v.packs * v.prix : 0);
  });

  const recouvSnap = await db.collection(COLLECTIONS.recouvrements).where("date", "==", date).get();
  recouvSnap.forEach((doc) => {
    totalEntrees += doc.data().montant || 0;
  });

  // Sorties: dépenses du jour
  const depensesSnap = await db.collection(COLLECTIONS.depenses).where("date", "==", date).get();
  let totalSorties = 0;
  depensesSnap.forEach((doc) => {
    totalSorties += doc.data().montant || 0;
  });

  const soldeAttendu = totalEntrees - totalSorties;
  const ecart = montantCompte - soldeAttendu;

  if (ecart !== 0 && (!explicationEcart || explicationEcart.trim() === "")) {
    throw new functions.https.HttpsError("invalid-argument", "Une explication est obligatoire quand il y a un écart de caisse.");
  }

  // Verrouiller toutes les entités de cette date
  const batch = db.batch();

  ventesSnap.forEach((doc) => {
    batch.update(doc.ref, { _locked: true });
  });
  depensesSnap.forEach((doc) => {
    batch.update(doc.ref, { _locked: true });
  });

  // Enregistrer la clôture dans params
  const paramsRef = db.collection(COLLECTIONS.params).doc("global");
  const paramsDoc = await paramsRef.get();
  const currentClotures = paramsDoc.exists ? (paramsDoc.data()?.clotures || []) : [];
  currentClotures.push({
    date,
    verrouille: true,
    montantAttendu: soldeAttendu,
    montantCompte,
    ecart,
    explicationEcart: explicationEcart || "",
    clotureePar: context.auth!.token.email || context.auth!.uid,
    clotureeLe: new Date().toISOString(),
  });
  batch.set(paramsRef, {
    clotures: currentClotures,
    clotureesDates: computeClotureesDates(currentClotures),
  }, { merge: true });

  // Audit
  const auditRef = db.collection(COLLECTIONS.auditLog).doc();
  batch.set(auditRef, {
    action: "cloture",
    module: "caisse",
    entityId: date,
    details: `Clôture ${date}: attendu=${soldeAttendu}, compté=${montantCompte}, écart=${ecart}`,
    userId: context.auth!.uid,
    userEmail: context.auth!.token.email || "",
    userRole: context.auth!.token.role || "",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { soldeAttendu, ecart };
});

// ============================================================
// 8. VÉRIFICATION D'INTÉGRITÉ
// Nom callable: "integrityCheck"
// ============================================================
export const integrityCheck = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  const details: string[] = [];
  let stockCoherent = true;
  let caisseCoherente = true;
  let creancesCoherentes = true;

  // Vérifier les ventes
  const ventesSnap = await db.collection(COLLECTIONS.ventes).get();
  ventesSnap.forEach((doc) => {
    const v = doc.data();
    if (v.packs < 0) { stockCoherent = false; details.push(`Vente ${v.id}: packs négatif`); }
    if (v.prix < 0) { caisseCoherente = false; details.push(`Vente ${v.id}: prix négatif`); }
    if (v.avance && v.avance > v.packs * v.prix) {
      caisseCoherente = false;
      details.push(`Vente ${v.id}: avance > montant total`);
    }
  });

  // Vérifier les recouvrements
  const recouvSnap = await db.collection(COLLECTIONS.recouvrements).get();
  const recouvrementsByVente: Record<string, number> = {};
  recouvSnap.forEach((doc) => {
    const r = doc.data();
    if (r.montant < 0) { creancesCoherentes = false; details.push(`Recouvrement ${r.id}: montant négatif`); }
    recouvrementsByVente[r.venteId] = (recouvrementsByVente[r.venteId] || 0) + r.montant;
  });

  // Vérifier que les recouvrements ne dépassent pas la dette
  ventesSnap.forEach((doc) => {
    const v = doc.data();
    const montantTotal = v.packs * v.prix;
    const avance = v.avance || (v.mode === "Payé" ? montantTotal : 0);
    const resteAPayer = montantTotal - avance;
    const totalRecouv = recouvrementsByVente[v.id] || 0;
    if (totalRecouv > resteAPayer + 1) {
      creancesCoherentes = false;
      details.push(`Vente ${v.id}: recouvrements (${totalRecouv}) > reste (${resteAPayer})`);
    }
  });

  // Vérifier les mouvements de stock
  const mvtSnap = await db.collection(COLLECTIONS.mouvementsStock).get();
  let stockUsine = 0;
  mvtSnap.forEach((doc) => {
    const m = doc.data();
    if (m.emplacement === "usine") {
      if (m.type === "production" || m.type === "retour") stockUsine += m.quantite;
      else if (m.type === "vente" || m.type === "chargement" || m.type === "casse") stockUsine -= m.quantite;
    }
  });
  if (stockUsine < 0) {
    stockCoherent = false;
    details.push(`Stock usine négatif: ${stockUsine} packs`);
  }

  if (details.length === 0) {
    details.push("Aucune anomalie détectée");
  }

  return { stockCoherent, caisseCoherente, creancesCoherentes, details };
});

// ============================================================
// 9. RÉ-AUTHENTIFICATION
// Nom callable: "reauthenticate"
// ============================================================
export const reauthenticate = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);

  const { action, targetId } = data;
  if (!action) {
    throw new functions.https.HttpsError("invalid-argument", "Action requise.");
  }

  // Vérifier que l'utilisateur est bien admin pour les actions sensibles
  const sensitiveActions = ["delete_user", "modify_role", "annuler_cloture", "reset_data"];
  if (sensitiveActions.includes(action) && context.auth!.token.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Action réservée aux administrateurs.");
  }

  // Générer un token temporaire (valide 5 minutes)
  const token = `reauth_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Logger la ré-authentification
  await logAudit(context, "reauthenticate", "security", `Action: ${action}, Target: ${targetId || "N/A"}`);

  return { token, expiresAt };
});

// ============================================================
// 10. ANNULATION DE CLÔTURE
// ============================================================
export const annulerCloture = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  const { date, motif } = data;
  if (!date || typeof date !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Date requise.");
  }
  if (!motif || typeof motif !== "string" || motif.trim().length < 10) {
    throw new functions.https.HttpsError("invalid-argument", "Un motif détaillé (min 10 caractères) est obligatoire.");
  }

  // Retirer la clôture de la liste
  const paramsRef = db.collection(COLLECTIONS.params).doc("global");
  const paramsDoc = await paramsRef.get();
  const clotures = paramsDoc.exists ? (paramsDoc.data()?.clotures || []) : [];
  const updatedClotures = clotures.map((c: any) => {
    if (c.date === date) return { ...c, verrouille: false, annulePar: context.auth!.uid, annuleLe: new Date().toISOString(), motifAnnulation: motif };
    return c;
  });

  await paramsRef.set({
    clotures: updatedClotures,
    clotureesDates: computeClotureesDates(updatedClotures),
  }, { merge: true });

  // Déverrouiller les entités de cette date
  const batch = db.batch();
  const ventesSnap = await db.collection(COLLECTIONS.ventes).where("date", "==", date).get();
  ventesSnap.forEach((doc) => batch.update(doc.ref, { _locked: false }));
  const depensesSnap = await db.collection(COLLECTIONS.depenses).where("date", "==", date).get();
  depensesSnap.forEach((doc) => batch.update(doc.ref, { _locked: false }));
  await batch.commit();

  await logAudit(context, "annulation_cloture", "caisse", `Annulation clôture ${date}: ${motif}`, date);

  return { valid: true, message: `Clôture du ${date} annulée.` };
});

// ============================================================
// 10bis. BACKFILL DE params/global.clotureesDates
// Nom callable: "backfillClotureesDates"
// Correctif du 2026-08-29 (voir firestore.rules) : le verrou de clôture
// appliqué désormais par firestore.rules sur ventes/depenses/production/
// recouvrements/versements/apports/mouvements_stock lit
// params/global.clotureesDates, un champ nouvellement introduit et
// recalculé automatiquement par cloturerCaisse/annulerCloture à chaque
// clôture/annulation. Les journées déjà clôturées AVANT ce déploiement et
// jamais retouchées depuis n'y figurent pas encore, donc les documents de
// ces journées restent modifiables tant que cette fonction n'a pas tourné
// une fois. Idempotente et sans effet de bord (ne fait que recalculer
// clotureesDates depuis clotures[], la source de vérité existante) — à
// appeler une fois après le déploiement de ce correctif, depuis la rubrique
// Sauvegardes/Intégrité de l'app ou via la console Firebase.
// ============================================================
export const backfillClotureesDates = functions.https.onCall(async (data, context) => {
  assertAdmin(context);

  const paramsRef = db.collection(COLLECTIONS.params).doc("global");
  const paramsDoc = await paramsRef.get();
  const clotures = paramsDoc.exists ? (paramsDoc.data()?.clotures || []) : [];
  const clotureesDates = computeClotureesDates(clotures);

  await paramsRef.set({ clotureesDates }, { merge: true });
  await logAudit(context, "backfill", "caisse", `Backfill clotureesDates: ${clotureesDates.length} journée(s) verrouillée(s).`);

  return { clotureesDates };
});

// ============================================================
// 11. HEALTH CHECK
// Nom callable: "healthCheck"
// ============================================================
export const healthCheck = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);

  return {
    status: "ok",
    version: "2.0.0",
    architecture: "phase2",
    timestamp: new Date().toISOString(),
    features: [
      "atomic_transactions",
      "optimistic_locking",
      "server_timestamps",
      "custom_claims",
      "audit_log",
      "daily_backup",
    ],
  };
});

// ============================================================
// 12. SAUVEGARDE AUTOMATIQUE QUOTIDIENNE — SUPPRIMÉE (doublon)
// ============================================================
// Cette fonction dupliquait `dailyBackupToGoogleDrive` (functions/src/index.ts,
// seule codebase réellement déployée — voir firebase.json). Elle copiait les
// données dans une collection Firestore du MÊME projet (`backups_auto`), ce qui
// n'offre pas de copie hors-site (single point of failure) contrairement à
// l'export Excel vers Google Drive. Supprimée pour éviter toute confusion ou
// double sauvegarde si ce dossier est un jour déployé. Si une sauvegarde
// Firestore→Firestore intra-projet est un jour souhaitée en complément (par ex.
// pour un restore plus rapide qu'un ré-import Excel), la réintroduire sous un
// nom distinct en la documentant clairement comme secondaire.
/* istanbul ignore next — bloc conservé en commentaire pour référence historique
export const dailyBackup_DEPRECATED = functions.pubsub
  .schedule("every day 23:00")
  .timeZone("Africa/Douala")
  .onRun(async () => {
    const collectionsToBackup = [
      COLLECTIONS.ventes,
      COLLECTIONS.clients,
      COLLECTIONS.production,
      COLLECTIONS.depenses,
      COLLECTIONS.recouvrements,
      COLLECTIONS.mouvementsStock,
      COLLECTIONS.params,
      COLLECTIONS.meta,
    ];

    const backupData: Record<string, any> = {};
    for (const coll of collectionsToBackup) {
      const snapshot = await db.collection(coll).get();
      backupData[coll] = {};
      snapshot.forEach((doc) => {
        backupData[coll][doc.id] = doc.data();
      });
    }

    const backupId = new Date().toISOString().split("T")[0];
    await db.collection(COLLECTIONS.backups).doc(backupId).set({
      data: JSON.stringify(backupData),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      size: JSON.stringify(backupData).length,
      collections: collectionsToBackup,
    });

    // Nettoyer les sauvegardes > 90 jours
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const oldBackups = await db.collection(COLLECTIONS.backups)
      .where("createdAt", "<", cutoff)
      .get();

    const batch = db.batch();
    oldBackups.forEach((doc) => batch.delete(doc.ref));
    if (!oldBackups.empty) await batch.commit();

    console.log(`Backup ${backupId}: ${JSON.stringify(backupData).length} octets`);
  });
*/

// ============================================================
// 14. PAIEMENT MOBILE MONEY — WAVE (Checkout API)
// ============================================================
// Intégration Wave Business (https://docs.wave.com/checkout). Flux :
//  1. createWaveCheckoutSession (callable, appelé depuis Recouvrement) crée
//     une "intention de paiement" dans mobileMoneyIntents ET une session
//     Wave, puis renvoie wave_launch_url à partager au client (WhatsApp,
//     SMS...).
//  2. waveWebhook (HTTP, appelé par Wave — jamais par l'app elle-même) reçoit
//     l'événement checkout.session.completed, vérifie la signature HMAC
//     (Wave-Signature: t=..,v1=..) et ne crée le recouvrement RÉEL (immuable,
//     voir firestore.rules) qu'à ce moment précis — jamais au moment de la
//     simple génération du lien, pour ne jamais faire apparaître un
//     encaissement qui n'a en réalité pas eu lieu (lien généré puis jamais
//     payé, payé en retard, etc.).
//
// Variables d'environnement requises (cloud-functions/.env — voir
// .env.example, ne jamais committer les vraies valeurs) :
//   WAVE_API_KEY          — clé API du compte marchand Wave Business (Bearer)
//   WAVE_WEBHOOK_SECRET   — secret de signature du webhook (Business Portal,
//                           section Développeur → Webhooks)
//   APP_URL               — URL de l'app pour success_url/error_url
//                           (optionnel, replie sur le domaine Vercel)
// ============================================================
const MM_INTENTS = "mobileMoneyIntents";

export const createWaveCheckoutSession = functions.https.onCall(async (data, context) => {
  assertRole(context, ["admin", "caissier", "commercial"]);

  const { venteId, clientId, clientNom, montant } = data;
  if (!clientNom || typeof clientNom !== "string" || clientNom.trim() === "") {
    throw new functions.https.HttpsError("invalid-argument", "Le client est obligatoire.");
  }
  const montantNum = Number(montant);
  if (!montantNum || montantNum <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Montant invalide.");
  }
  if (montantNum > 10000000) {
    throw new functions.https.HttpsError("invalid-argument", "Montant anormalement élevé (max 10 000 000 F).");
  }

  const apiKey = process.env.WAVE_API_KEY;
  if (!apiKey) {
    throw new functions.https.HttpsError("failed-precondition", "Wave n'est pas configuré côté serveur (WAVE_API_KEY manquant).");
  }

  // Si lié à une vente à crédit, vérifier que le montant demandé ne dépasse
  // pas le reste réellement dû — même contrôle que validatePaiement, pour ne
  // pas générer un lien de paiement pour un montant incohérent.
  let numeroBL = "";
  if (venteId) {
    const venteDoc = await db.collection(COLLECTIONS.ventes).doc(venteId).get();
    if (venteDoc.exists) {
      const vente = venteDoc.data()!;
      numeroBL = vente.numero || "";
      const montantTotal = vente.packs * vente.prix;
      const avance = vente.avance || (vente.mode === "Payé" ? montantTotal : 0);
      const recSnap = await db.collection(COLLECTIONS.recouvrements).where("venteId", "==", venteId).get();
      let totalRecouv = 0;
      recSnap.forEach((d) => { totalRecouv += d.data().montant || 0; });
      const reste = montantTotal - avance - totalRecouv;
      if (montantNum > reste + 1) {
        throw new functions.https.HttpsError("invalid-argument", `Le montant (${montantNum} F) dépasse le reste dû (${reste} F).`);
      }
    }
  }

  const intentId = `wmm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const appUrl = process.env.APP_URL || "https://ma2f-aquasachet.vercel.app";

  let session: any;
  try {
    const resp = await fetch("https://api.wave.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: String(Math.round(montantNum)), // XOF n'accepte pas de décimales
        currency: "XOF",
        client_reference: intentId,
        success_url: appUrl,
        error_url: appUrl,
      }),
    });
    session = await resp.json();
    if (!resp.ok) {
      throw new Error(session?.error_message || session?.message || `Erreur Wave (HTTP ${resp.status})`);
    }
  } catch (e: any) {
    throw new functions.https.HttpsError("internal", `Erreur lors de la création de la session Wave : ${e.message || e}`);
  }

  await db.collection(MM_INTENTS).doc(intentId).set({
    id: intentId,
    provider: "wave",
    venteId: venteId || "",
    numeroBL,
    clientId: clientId || "",
    client: clientNom.trim(),
    montant: montantNum,
    statut: "en_attente",
    waveSessionId: session.id,
    waveCheckoutUrl: session.wave_launch_url,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _createdBy: context.auth!.uid,
  });

  await logAudit(context, "create", "mobileMoneyIntents", `Lien Wave généré : ${clientNom} - ${montantNum} F`, intentId);

  return { intentId, checkoutUrl: session.wave_launch_url as string };
});

export const waveWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

  const secret = process.env.WAVE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("WAVE_WEBHOOK_SECRET manquant — webhook Wave refusé.");
    res.status(500).send("Webhook not configured");
    return;
  }

  // Vérification de signature — voir https://docs.wave.com/webhook. Le
  // header est "t={timestamp},v1={signature}", signature = HMAC-SHA256 du
  // corps BRUT de la requête précédé du timestamp, avec le secret de webhook
  // comme clé. Utiliser req.rawBody (Buffer fourni par Firebase Functions
  // pour les fonctions HTTP) et non req.body : re-sérialiser le JSON parsé
  // produirait un corps légèrement différent (ordre des clés, espaces) et
  // ferait échouer la vérification.
  const sigHeader = req.get("Wave-Signature") || "";
  const match = /t=(\d+),v1=([0-9a-f]+)/.exec(sigHeader);
  if (!match) { res.status(401).send("Missing or malformed signature"); return; }
  const [, timestampStr, providedSig] = match;

  const timestamp = Number(timestampStr);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    res.status(401).send("Expired or invalid timestamp");
    return;
  }

  const rawBody: Buffer = (req as any).rawBody;
  const expectedSig = crypto.createHmac("sha256", secret).update(`${timestampStr}${rawBody.toString()}`).digest("hex");

  const providedBuf = Buffer.from(providedSig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  const isValid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!isValid) {
    console.error("Signature Wave invalide — requête rejetée.");
    res.status(401).send("Invalid signature");
    return;
  }

  const event = req.body;
  if (event?.type !== "checkout.session.completed") {
    res.status(200).send("ignored");
    return;
  }

  const session = event.data;
  const intentId = session?.client_reference;
  if (!intentId) { res.status(200).send("no client_reference"); return; }

  const intentRef = db.collection(MM_INTENTS).doc(intentId);
  const intentDoc = await intentRef.get();
  if (!intentDoc.exists) { res.status(200).send("unknown intent"); return; }
  const intent = intentDoc.data()!;

  // Idempotence : Wave peut renvoyer le même webhook plusieurs fois (retries)
  // — ne jamais créer un second recouvrement pour la même intention.
  if (intent.statut === "confirme") { res.status(200).send("already processed"); return; }

  if (session.payment_status !== "succeeded") {
    await intentRef.update({ statut: "echoue", _updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send("payment not successful");
    return;
  }

  const recId = `rec_wave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const batch = db.batch();
  const recRef = db.collection(COLLECTIONS.recouvrements).doc(recId);
  batch.set(recRef, {
    id: recId,
    venteId: intent.venteId || "",
    numeroBL: intent.numeroBL || "",
    client: intent.client,
    clientId: intent.clientId || "",
    montant: intent.montant,
    mode: "Wave",
    date: new Date().toISOString().slice(0, 10), // Dakar = UTC+0, pas de décalage de fuseau à corriger ici
    notes: `Paiement Wave confirmé automatiquement (transaction ${session.transaction_id || session.id})`,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _createdBy: "wave_webhook",
    _locked: true,
  });
  batch.update(intentRef, {
    statut: "confirme",
    recouvrementId: recId,
    confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const auditRef = db.collection(COLLECTIONS.auditLog).doc();
  batch.set(auditRef, {
    action: "create",
    module: "recouvrements",
    entityId: recId,
    details: `Paiement Wave confirmé : ${intent.montant} F pour ${intent.client}`,
    userId: "wave_webhook",
    userEmail: "",
    userRole: "system",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  res.status(200).send("ok");
});

// ============================================================
// 13. TRIGGER: Verrouiller les entités après clôture
// ============================================================
export const onClotureWrite = functions.firestore
  .document("params/global")
  .onWrite(async (change, context) => {
    const after = change.after.data();
    if (!after) return;

    const clotures = after.clotures || [];
    const activeClotures = clotures.filter((c: any) => c.verrouille === true);

    // Pour chaque date clôturée, s'assurer que les documents sont verrouillés
    for (const cloture of activeClotures) {
      const date = cloture.date;
      const batch = db.batch();
      let hasUpdates = false;

      const ventesSnap = await db.collection(COLLECTIONS.ventes)
        .where("date", "==", date)
        .where("_locked", "==", false)
        .get();
      ventesSnap.forEach((doc) => {
        batch.update(doc.ref, { _locked: true });
        hasUpdates = true;
      });

      const depensesSnap = await db.collection(COLLECTIONS.depenses)
        .where("date", "==", date)
        .where("_locked", "==", false)
        .get();
      depensesSnap.forEach((doc) => {
        batch.update(doc.ref, { _locked: true });
        hasUpdates = true;
      });

      if (hasUpdates) await batch.commit();
    }
  });

// ============================================================
// 15. SUIVI GPS TEMPS RÉEL DES CAMIONS (boîtier GPS physique)
// ============================================================
// Webhook générique (HTTP, appelé par la plateforme de tracking du boîtier
// GPS installé dans chaque camion — Traccar auto-hébergé, ou la plateforme
// d'un fabricant — JAMAIS par l'app elle-même) qui reçoit une position et
// l'écrit dans positionsVehicules/{vehiculeId} (voir firestore.rules :
// écriture exclusivement via cette fonction, lecture par tout utilisateur
// authentifié). SuiviLogistiqueSection.tsx affiche ces positions en direct.
//
// C'est INTENTIONNELLEMENT un format générique plutôt que le protocole natif
// d'un boîtier précis (ex: GT06) : quel que soit le matériel/la plateforme
// de tracking retenus, il suffit de configurer un envoi HTTP POST vers cette
// URL avec ce payload JSON — via un webhook natif si la plateforme en
// propose un, ou un petit script relais qui interroge son API et retransmet
// ici (cas de Traccar : lire son API REST/WebSocket et republier chaque
// position dans ce format — voir https://www.traccar.org/api-reference/).
//
// Variable d'environnement requise (cloud-functions/.env, voir .env.example) :
//   GPS_WEBHOOK_SECRET — secret partagé, à fournir dans l'en-tête
//                         X-Webhook-Secret de chaque requête. Générer une
//                         valeur aléatoire longue (ex: openssl rand -hex 32)
//                         et configurer la même valeur côté plateforme/relais.
//
// Payload JSON attendu :
//   {
//     "traceurId": "868xxxxxxxxxxxx", // IMEI du boîtier ou id device de la plateforme — doit correspondre à Vehicule.traceurId (VehiculesSection.tsx)
//     "lat": 14.7167,
//     "lng": -17.4677,
//     "vitesseKmH": 32,                // optionnel
//     "capDegres": 180,                // optionnel, 0-360
//     "horodatage": "2026-08-22T10:15:00.000Z" // optionnel, ISO — sinon l'heure de réception (_receivedAt) fait foi
//   }
//
// Endpoint volontairement PUBLIC côté Firebase (pas de vérification
// request.auth : un boîtier/relais GPS externe ne peut pas s'authentifier
// avec le SDK client Firebase) — la sécurité repose entièrement sur le
// secret partagé ci-dessus, comparé en temps constant (timingSafeEqual)
// comme pour waveWebhook au-dessus.
export const recevoirPositionVehicule = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

  const secret = process.env.GPS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GPS_WEBHOOK_SECRET manquant — webhook position GPS refusé.");
    res.status(500).send("Webhook not configured");
    return;
  }
  const provided = req.get("X-Webhook-Secret") || "";
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(secret);
  const isValid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!isValid) {
    console.error("Secret webhook GPS invalide — requête rejetée.");
    res.status(401).send("Invalid secret");
    return;
  }

  const { traceurId, lat, lng, vitesseKmH, capDegres, horodatage } = req.body || {};
  if (!traceurId || typeof traceurId !== "string") {
    res.status(400).send("traceurId requis");
    return;
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    res.status(400).send("lat/lng invalides");
    return;
  }
  // Garde-fou grossier (fenêtre Sénégal élargie) plutôt que d'accepter
  // silencieusement une coordonnée aberrante — erreur fréquente côté
  // boîtier/relais GPS (ex: position 0,0 avant premier fix satellite).
  if (latNum < 11 || latNum > 17 || lngNum < -18 || lngNum > -11) {
    res.status(400).send("Position hors zone attendue (Sénégal) — vérifiez lat/lng");
    return;
  }

  // Les véhicules vivent dans meta/data.vehicules (format "Phase 2 léger",
  // voir "Data model" dans CLAUDE.md), pas dans une collection Firestore
  // séparée — on résout donc le traceurId depuis là, comme isDateCloturee()
  // le fait déjà pour params ci-dessus.
  const metaDoc = await db.collection(COLLECTIONS.meta).doc("data").get();
  const vehicules: any[] = metaDoc.data()?.vehicules || [];
  const vehicule = vehicules.find((v) => v.traceurId === traceurId);
  if (!vehicule) {
    console.warn(`Position GPS reçue pour un traceurId inconnu : "${traceurId}" — aucun Vehicule.traceurId ne correspond (à associer dans Véhicules).`);
    res.status(404).send("traceurId inconnu — associez-le à un camion dans Véhicules");
    return;
  }

  await db.collection("positionsVehicules").doc(vehicule.id).set({
    id: vehicule.id,
    vehiculeId: vehicule.id,
    lat: latNum,
    lng: lngNum,
    vitesseKmH: Number.isFinite(Number(vitesseKmH)) ? Number(vitesseKmH) : null,
    capDegres: Number.isFinite(Number(capDegres)) ? Number(capDegres) : null,
    horodatage: typeof horodatage === "string" ? horodatage : null,
    _receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(200).send("ok");
});
