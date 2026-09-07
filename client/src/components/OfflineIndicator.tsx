import { useState, useEffect } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { isOnline, onConnectivityChange, getSyncStats, clearSyncQueue, loadSyncQueue } from "@/lib/offlineSync";

/**
 * Indicateur de connectivité affiché en bas de la sidebar
 * Montre le statut en ligne/hors-ligne et les opérations en attente
 */
export default function OfflineIndicator() {
  const [online, setOnline] = useState(isOnline());
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const cleanup = onConnectivityChange(
      () => setOnline(true),
      () => setOnline(false)
    );

    // Vérifier les opérations en attente
    const checkPending = () => {
      const stats = getSyncStats();
      setPendingCount(stats.pendingCount);
    };
    checkPending();
    const interval = setInterval(checkPending, 3000);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  // Forcer la synchronisation manuelle (vider la queue)
  const handleForceSync = () => {
    const queue = loadSyncQueue();
    if (queue.length > 0) {
      // Vider la queue — les données sont déjà sauvegardées localement
      // et seront synchronisées au prochain saveDB
      clearSyncQueue();
      setPendingCount(0);
    }
  };

  if (online && pendingCount === 0) {
    return null; // Pas besoin d'afficher quand tout va bien
  }

  if (!online) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-700 bg-red-50 rounded-md border border-red-200">
        <WifiOff className="w-3.5 h-3.5" />
        <span>Hors ligne</span>
      </div>
    );
  }

  // En ligne mais avec des opérations en attente
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-amber-700 bg-amber-50 rounded-md border border-amber-200 cursor-pointer" onClick={handleForceSync} title="Cliquer pour forcer la synchronisation">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      <span>{pendingCount} op. en attente</span>
    </div>
  );
}
