/**
 * Firestore Service — MA2F AquaSachet
 * 
 * Architecture Phase 2 : 1 document = 1 entité
 * 
 * Ce module fournit un service CRUD par collection avec :
 * - Transactions atomiques (batch writes)
 * - Timestamps serveur
 * - Verrouillage optimiste (champ _version)
 * - Pagination Firestore
 * - Migration transparente depuis l'ancien format (document unique)
 */

import {
  db,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from "@/lib/firebase";
import type {
  DocumentSnapshot,
  QueryConstraint,
} from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FirestoreEntity {
  id: string;
  _version?: number;
  _createdAt?: string;
  _updatedAt?: string;
  _createdBy?: string;
  _updatedBy?: string;
  [key: string]: any;
}

export interface PaginatedResult<T> {
  items: T[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
  total?: number;
}

export interface BatchOperation {
  type: "create" | "update" | "delete";
  collection: string;
  id: string;
  data?: Record<string, any>;
}

// ─── Collections Map ──────────────────────────────────────────────────────────

export const ENTITY_COLLECTIONS = {
  ventes: "ventes",
  clients: "clients",
  production: "production",
  depenses: "depenses",
  recouvrements: "recouvrements",
  livraisons: "livraisons",
  emballages: "emballages",
  commerciaux: "commerciaux",
  livreurs: "livreurs",
  maintenance: "maintenance",
  versements: "versements",
  apports: "apports",
  vehicules: "vehicules",
  vehiculeOps: "vehicule_ops",
  mouvementsStock: "mouvements_stock",
  journal: "journal",
  history: "history",
  notifications: "notifications",
  reconciliations: "reconciliations",
  stockControles: "stock_controles",
  users: "users",
  corbeille: "corbeille",
  backups: "backups",
} as const;

// Collection pour les paramètres (document unique)
export const PARAMS_COLLECTION = "params";
export const PARAMS_DOC_ID = "global";

// ─── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * Créer une entité dans une collection
 */
export async function createEntity(
  collectionName: string,
  entity: FirestoreEntity,
  userName: string
): Promise<void> {
  const docRef = doc(db, collectionName, entity.id);
  await setDoc(docRef, {
    ...entity,
    _version: 1,
    _createdAt: new Date().toISOString(),
    _updatedAt: new Date().toISOString(),
    _createdBy: userName,
    _updatedBy: userName,
    _serverTimestamp: serverTimestamp(),
  });
}

/**
 * Mettre à jour une entité avec verrouillage optimiste
 */
export async function updateEntity(
  collectionName: string,
  id: string,
  updates: Record<string, any>,
  userName: string,
  expectedVersion?: number
): Promise<{ success: boolean; error?: string }> {
  const docRef = doc(db, collectionName, id);

  // Verrouillage optimiste : vérifier la version
  if (expectedVersion !== undefined) {
    const currentDoc = await getDoc(docRef);
    if (currentDoc.exists()) {
      const currentVersion = currentDoc.data()?._version || 0;
      if (currentVersion !== expectedVersion) {
        return {
          success: false,
          error: `Conflit de version : attendu v${expectedVersion}, trouvé v${currentVersion}. Un autre utilisateur a modifié cette donnée.`,
        };
      }
    }
  }

  await updateDoc(docRef, {
    ...updates,
    _version: increment(1),
    _updatedAt: new Date().toISOString(),
    _updatedBy: userName,
    _serverTimestamp: serverTimestamp(),
  });

  return { success: true };
}

/**
 * Supprimer une entité (soft delete vers corbeille ou hard delete)
 */
export async function deleteEntity(
  collectionName: string,
  id: string
): Promise<void> {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
}

/**
 * Lire une entité par ID
 */
export async function getEntity<T extends FirestoreEntity>(
  collectionName: string,
  id: string
): Promise<T | null> {
  const docRef = doc(db, collectionName, id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as T;
  }
  return null;
}

/**
 * Lire toutes les entités d'une collection
 */
export async function getAllEntities<T extends FirestoreEntity>(
  collectionName: string
): Promise<T[]> {
  const collRef = collection(db, collectionName);
  const snapshot = await getDocs(collRef);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as T));
}

/**
 * Lire les entités avec pagination
 */
export async function getPaginatedEntities<T extends FirestoreEntity>(
  collectionName: string,
  pageSize: number = 50,
  lastDocument?: DocumentSnapshot,
  constraints: QueryConstraint[] = []
): Promise<PaginatedResult<T>> {
  const collRef = collection(db, collectionName);

  const queryConstraints: QueryConstraint[] = [
    ...constraints,
    orderBy("_createdAt", "desc"),
    limit(pageSize + 1), // +1 pour détecter s'il y a plus
  ];

  if (lastDocument) {
    queryConstraints.push(startAfter(lastDocument));
  }

  const q = query(collRef, ...queryConstraints);
  const snapshot = await getDocs(q);

  const items = snapshot.docs.slice(0, pageSize).map((doc) => ({
    id: doc.id,
    ...doc.data(),
  } as T));

  const hasMore = snapshot.docs.length > pageSize;
  const lastDoc = items.length > 0 ? snapshot.docs[items.length - 1] : null;

  return { items, lastDoc, hasMore };
}

/**
 * Écouter les changements en temps réel d'une collection
 */
export function subscribeToCollection<T extends FirestoreEntity>(
  collectionName: string,
  callback: (items: T[]) => void,
  errorCallback?: (error: Error) => void
): () => void {
  const collRef = collection(db, collectionName);
  const q = query(collRef, orderBy("_createdAt", "desc"));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as T));
      callback(items);
    },
    (error) => {
      console.error(`Erreur subscription ${collectionName}:`, error);
      errorCallback?.(error);
    }
  );
}

/**
 * Écouter un document unique (pour les params)
 */
export function subscribeToDocument<T>(
  collectionName: string,
  docId: string,
  callback: (data: T | null) => void,
  errorCallback?: (error: Error) => void
): () => void {
  const docRef = doc(db, collectionName, docId);

  return onSnapshot(
    docRef,
    (docSnap) => {
      if (docSnap.exists()) {
        callback(docSnap.data() as T);
      } else {
        callback(null);
      }
    },
    (error) => {
      console.error(`Erreur subscription ${collectionName}/${docId}:`, error);
      errorCallback?.(error);
    }
  );
}

// ─── Transactions Atomiques ───────────────────────────────────────────────────

/**
 * Exécuter un batch d'opérations atomiques.
 * Si une opération échoue, AUCUNE n'est appliquée.
 * 
 * Cas d'usage : Vente + mouvement stock + journal en une seule transaction
 */
export async function executeBatch(
  operations: BatchOperation[],
  userName: string
): Promise<{ success: boolean; error?: string }> {
  if (operations.length === 0) return { success: true };
  if (operations.length > 500) {
    return { success: false, error: "Maximum 500 opérations par batch" };
  }

  try {
    const batch = writeBatch(db);

    for (const op of operations) {
      const docRef = doc(db, op.collection, op.id);

      switch (op.type) {
        case "create":
          batch.set(docRef, {
            ...op.data,
            id: op.id,
            _version: 1,
            _createdAt: new Date().toISOString(),
            _updatedAt: new Date().toISOString(),
            _createdBy: userName,
            _updatedBy: userName,
            _serverTimestamp: serverTimestamp(),
          });
          break;

        case "update":
          batch.update(docRef, {
            ...op.data,
            _version: increment(1),
            _updatedAt: new Date().toISOString(),
            _updatedBy: userName,
            _serverTimestamp: serverTimestamp(),
          });
          break;

        case "delete":
          batch.delete(docRef);
          break;
      }
    }

    await batch.commit();
    return { success: true };
  } catch (e: any) {
    console.error("Erreur batch Firestore:", e);
    return { success: false, error: e.message || "Erreur transaction atomique" };
  }
}

/**
 * Transaction atomique pour une vente complète :
 * - Créer la vente
 * - Créer le mouvement de stock
 * - Créer l'entrée journal
 * - Créer l'entrée historique
 */
export async function transactionVente(
  vente: FirestoreEntity,
  mouvementStock: FirestoreEntity,
  journalEntry: FirestoreEntity,
  historyEntry: FirestoreEntity,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  return executeBatch(
    [
      { type: "create", collection: ENTITY_COLLECTIONS.ventes, id: vente.id, data: vente },
      { type: "create", collection: ENTITY_COLLECTIONS.mouvementsStock, id: mouvementStock.id, data: mouvementStock },
      { type: "create", collection: ENTITY_COLLECTIONS.journal, id: journalEntry.id, data: journalEntry },
      { type: "create", collection: ENTITY_COLLECTIONS.history, id: historyEntry.id, data: historyEntry },
    ],
    userName
  );
}

/**
 * Transaction atomique pour un paiement/recouvrement :
 * - Créer le recouvrement
 * - Créer l'entrée journal
 * - Créer l'entrée historique
 */
export async function transactionPaiement(
  recouvrement: FirestoreEntity,
  journalEntry: FirestoreEntity,
  historyEntry: FirestoreEntity,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  return executeBatch(
    [
      { type: "create", collection: ENTITY_COLLECTIONS.recouvrements, id: recouvrement.id, data: recouvrement },
      { type: "create", collection: ENTITY_COLLECTIONS.journal, id: journalEntry.id, data: journalEntry },
      { type: "create", collection: ENTITY_COLLECTIONS.history, id: historyEntry.id, data: historyEntry },
    ],
    userName
  );
}

/**
 * Transaction atomique pour une clôture :
 * - Créer/mettre à jour le document de clôture
 * - Créer l'entrée journal
 */
export async function transactionCloture(
  clotureData: FirestoreEntity,
  journalEntry: FirestoreEntity,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  return executeBatch(
    [
      { type: "create", collection: "clotures", id: clotureData.id, data: clotureData },
      { type: "create", collection: ENTITY_COLLECTIONS.journal, id: journalEntry.id, data: journalEntry },
    ],
    userName
  );
}

// ─── Migration Helper ─────────────────────────────────────────────────────────

/**
 * Migrer les données de l'ancien format (document unique avec arrays)
 * vers le nouveau format (1 document = 1 entité).
 * 
 * Cette fonction est idempotente : elle ne migre que si la collection cible est vide.
 */
export async function migrateFromLegacy(
  legacyData: Record<string, any[]>,
  userName: string
): Promise<{ migrated: string[]; skipped: string[]; errors: string[] }> {
  const migrated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const [field, collName] of Object.entries(ENTITY_COLLECTIONS)) {
    const items = legacyData[field];
    if (!items || !Array.isArray(items) || items.length === 0) {
      skipped.push(field);
      continue;
    }

    // Vérifier si la collection cible a déjà des données
    const collRef = collection(db, collName);
    const existingSnap = await getDocs(query(collRef, limit(1)));
    if (!existingSnap.empty) {
      skipped.push(`${field} (déjà migré)`);
      continue;
    }

    // Migrer par batch de 500
    try {
      for (let i = 0; i < items.length; i += 450) {
        const chunk = items.slice(i, i + 450);
        const batch = writeBatch(db);

        for (const item of chunk) {
          if (!item.id) continue;
          const docRef = doc(db, collName, item.id);
          batch.set(docRef, {
            ...item,
            _version: 1,
            _createdAt: item._createdAt || item.date || new Date().toISOString(),
            _updatedAt: new Date().toISOString(),
            _createdBy: item._createdBy || userName,
            _updatedBy: userName,
            _migrated: true,
            _migratedAt: new Date().toISOString(),
          });
        }

        await batch.commit();
      }
      // Supprimer l'ancien document "data" (tableau) : sinon le listener de
      // synchronisation continue de le lire en priorité et les nouveaux
      // documents individuels créés ci-dessus ne sont jamais pris en compte,
      // ce qui annule silencieusement la migration à la prochaine sauvegarde.
      try {
        await deleteDoc(doc(db, collName, "data"));
      } catch {
        // Non bloquant : le document a peut-être déjà été supprimé
      }
      migrated.push(`${field} (${items.length} docs)`);
    } catch (e: any) {
      errors.push(`${field}: ${e.message}`);
    }
  }

  return { migrated, skipped, errors };
}

/**
 * Sauvegarder les paramètres globaux
 */
export async function saveParams(
  params: Record<string, any>,
  userName: string
): Promise<void> {
  const docRef = doc(db, PARAMS_COLLECTION, PARAMS_DOC_ID);
  await setDoc(docRef, {
    ...params,
    _updatedAt: new Date().toISOString(),
    _updatedBy: userName,
    _serverTimestamp: serverTimestamp(),
  }, { merge: true });
}

/**
 * Écouter les paramètres globaux
 */
export function subscribeToParams(
  callback: (params: Record<string, any> | null) => void,
  errorCallback?: (error: Error) => void
): () => void {
  return subscribeToDocument(PARAMS_COLLECTION, PARAMS_DOC_ID, callback, errorCallback);
}

// ─── Exports pour les imports Firestore nécessaires ───────────────────────────

export { query, where, orderBy, limit, startAfter, serverTimestamp, increment };
export type { DocumentSnapshot, QueryConstraint };
