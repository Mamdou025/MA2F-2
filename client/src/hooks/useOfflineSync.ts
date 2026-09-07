import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadSyncQueue,
  loadFailedOps,
  dequeueOperation,
  markOperationFailed,
  onConnectivityChange,
  isOnline,
  updateLastSync,
  getSyncStats,
  type SyncStatus,
  type PendingOperation,
} from "@/lib/offlineSync";

interface OfflineSyncState {
  status: SyncStatus;
  pendingCount: number;
  failedCount: number;
  isSyncing: boolean;
  lastSyncAt: string | null;
}

/**
 * Hook React pour gérer la synchronisation hors-ligne
 * Détecte automatiquement la connectivité et synchronise les opérations en attente
 */
export function useOfflineSync(
  onSync?: (op: PendingOperation) => Promise<boolean>
) {
  const [state, setState] = useState<OfflineSyncState>({
    status: isOnline() ? "online" : "offline",
    pendingCount: 0,
    failedCount: 0,
    isSyncing: false,
    lastSyncAt: localStorage.getItem("ma2f_last_sync"),
  });

  const syncingRef = useRef(false);

  // Mettre à jour les compteurs
  const refreshCounts = useCallback(() => {
    const stats = getSyncStats();
    setState((prev) => ({
      ...prev,
      pendingCount: stats.pendingCount,
      failedCount: stats.failedCount,
    }));
  }, []);

  // Synchroniser les opérations en attente
  const syncPending = useCallback(async () => {
    if (syncingRef.current || !isOnline() || !onSync) return;

    const queue = loadSyncQueue();
    if (queue.length === 0) return;

    syncingRef.current = true;
    setState((prev) => ({ ...prev, status: "syncing", isSyncing: true }));

    for (const op of queue) {
      try {
        const success = await onSync(op);
        if (success) {
          dequeueOperation(op.id);
        } else {
          markOperationFailed(op.id);
        }
      } catch {
        markOperationFailed(op.id);
      }
    }

    updateLastSync();
    syncingRef.current = false;
    setState((prev) => ({
      ...prev,
      status: "online",
      isSyncing: false,
      lastSyncAt: new Date().toISOString(),
    }));
    refreshCounts();
  }, [onSync, refreshCounts]);

  // Écouter les changements de connectivité
  useEffect(() => {
    const cleanup = onConnectivityChange(
      () => {
        setState((prev) => ({ ...prev, status: "online" }));
        // Tenter la synchronisation à la reconnexion
        syncPending();
      },
      () => {
        setState((prev) => ({ ...prev, status: "offline" }));
      }
    );

    // Vérifier les opérations en attente au montage
    refreshCounts();

    return cleanup;
  }, [syncPending, refreshCounts]);

  // Vérification périodique (toutes les 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      refreshCounts();
      if (isOnline() && !syncingRef.current) {
        syncPending();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [syncPending, refreshCounts]);

  return {
    ...state,
    syncNow: syncPending,
    refreshCounts,
  };
}
