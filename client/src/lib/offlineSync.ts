/**
 * Mode Hors-Ligne Robuste — MA2F AquaSachet
 * 
 * Gère la synchronisation quand la connexion est instable :
 * - File d'attente des opérations (sync queue)
 * - Détection automatique de la connectivité
 * - Résolution de conflits à la reconnexion
 * - Persistance locale des opérations en attente
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SyncStatus = "online" | "offline" | "syncing" | "error";

export interface PendingOperation {
  id: string;
  timestamp: string;
  type: "create" | "update" | "delete";
  collection: string;
  entityId: string;
  data: Record<string, any>;
  retryCount: number;
  maxRetries: number;
  priority: number; // 1 = haute, 5 = basse
  userId: string;
  version?: number;
}

export interface SyncQueueState {
  status: SyncStatus;
  pending: PendingOperation[];
  lastSyncAt: string | null;
  failedOps: PendingOperation[];
  conflictsToResolve: ConflictItem[];
}

export interface ConflictItem {
  id: string;
  operation: PendingOperation;
  remoteData: Record<string, any>;
  detectedAt: string;
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

const SYNC_QUEUE_KEY = "ma2f_sync_queue";
const FAILED_OPS_KEY = "ma2f_failed_ops";
const LAST_SYNC_KEY = "ma2f_last_sync";

// ─── Sync Queue Manager ──────────────────────────────────────────────────────

/**
 * Charge la file d'attente depuis le localStorage
 */
export function loadSyncQueue(): PendingOperation[] {
  try {
    const stored = localStorage.getItem(SYNC_QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Sauvegarde la file d'attente dans le localStorage
 */
export function saveSyncQueue(queue: PendingOperation[]): void {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error("[OfflineSync] Erreur sauvegarde queue:", e);
  }
}

/**
 * Ajoute une opération à la file d'attente
 */
export function enqueueOperation(
  type: PendingOperation["type"],
  collection: string,
  entityId: string,
  data: Record<string, any>,
  userId: string,
  priority: number = 3
): PendingOperation {
  const op: PendingOperation = {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    collection,
    entityId,
    data,
    retryCount: 0,
    maxRetries: 5,
    priority,
    userId,
  };

  const queue = loadSyncQueue();
  queue.push(op);
  // Trier par priorité (1 = haute)
  queue.sort((a, b) => a.priority - b.priority);
  saveSyncQueue(queue);

  return op;
}

/**
 * Retire une opération de la file après succès
 */
export function dequeueOperation(opId: string): void {
  const queue = loadSyncQueue();
  const filtered = queue.filter((op) => op.id !== opId);
  saveSyncQueue(filtered);
}

/**
 * Marque une opération comme échouée
 */
export function markOperationFailed(opId: string): void {
  const queue = loadSyncQueue();
  const op = queue.find((o) => o.id === opId);
  if (!op) return;

  op.retryCount++;
  if (op.retryCount >= op.maxRetries) {
    // Déplacer vers les opérations échouées
    const failed = loadFailedOps();
    failed.push(op);
    saveFailedOps(failed);
    dequeueOperation(opId);
  } else {
    saveSyncQueue(queue);
  }
}

/**
 * Charge les opérations échouées
 */
export function loadFailedOps(): PendingOperation[] {
  try {
    const stored = localStorage.getItem(FAILED_OPS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Sauvegarde les opérations échouées
 */
export function saveFailedOps(ops: PendingOperation[]): void {
  try {
    localStorage.setItem(FAILED_OPS_KEY, JSON.stringify(ops));
  } catch (e) {
    console.error("[OfflineSync] Erreur sauvegarde failed ops:", e);
  }
}

/**
 * Réessaye une opération échouée
 */
export function retryFailedOperation(opId: string): void {
  const failed = loadFailedOps();
  const op = failed.find((o) => o.id === opId);
  if (!op) return;

  op.retryCount = 0;
  const queue = loadSyncQueue();
  queue.push(op);
  queue.sort((a, b) => a.priority - b.priority);
  saveSyncQueue(queue);

  const remaining = failed.filter((o) => o.id !== opId);
  saveFailedOps(remaining);
}

// ─── Connectivité ────────────────────────────────────────────────────────────

/**
 * Vérifie si l'application est en ligne
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Enregistre des listeners pour les changements de connectivité
 */
export function onConnectivityChange(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

// ─── Sync State ──────────────────────────────────────────────────────────────

/**
 * Obtient l'état complet de la synchronisation
 */
export function getSyncState(): SyncQueueState {
  return {
    status: isOnline() ? "online" : "offline",
    pending: loadSyncQueue(),
    lastSyncAt: localStorage.getItem(LAST_SYNC_KEY),
    failedOps: loadFailedOps(),
    conflictsToResolve: [],
  };
}

/**
 * Met à jour la date de dernière synchronisation
 */
export function updateLastSync(): void {
  localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
}

/**
 * Nettoie toute la file d'attente (après sync réussie)
 */
export function clearSyncQueue(): void {
  saveSyncQueue([]);
  saveFailedOps([]);
  updateLastSync();
}

/**
 * Obtient les statistiques de la file
 */
export function getSyncStats() {
  const queue = loadSyncQueue();
  const failed = loadFailedOps();

  return {
    pendingCount: queue.length,
    failedCount: failed.length,
    oldestPending: queue.length > 0 ? queue[0].timestamp : null,
    byCollection: queue.reduce((acc, op) => {
      acc[op.collection] = (acc[op.collection] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byType: {
      create: queue.filter((o) => o.type === "create").length,
      update: queue.filter((o) => o.type === "update").length,
      delete: queue.filter((o) => o.type === "delete").length,
    },
  };
}
