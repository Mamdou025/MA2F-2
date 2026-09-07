import { useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, Check, CheckCheck } from "lucide-react";
import { fmt } from "@/lib/helpers";
import type { Notification } from "@/lib/types";

function fmtDateTime(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Cloche de notifications internes (rappels envoyés par un admin, voir
// RappelDialog.tsx et types.ts Notification, added 2026-08-21). Affichée
// dans l'en-tête pour TOUT utilisateur connecté (App.tsx) — le contenu est
// filtré côté client sur currentUser.email, qui est aussi la donnée vérifiée
// côté serveur par firestore.rules pour l'action "marquer comme lu" (voir
// le commentaire sur Notification.destinataireEmail dans types.ts).
export default function NotificationBell() {
  const { DB, setDB, saveDB, currentUser } = useApp();

  const mesNotifications = useMemo(() => {
    if (!currentUser?.email) return [];
    const emailLower = currentUser.email.toLowerCase();
    return (DB.notifications || [])
      .filter((n) => (n.destinataireEmail || "").toLowerCase() === emailLower)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [DB.notifications, currentUser]);

  const nonLues = mesNotifications.filter((n) => !n.lu);

  const marquerCommeLu = (notif: Notification) => {
    const nowISO = new Date().toISOString();
    const updated = {
      ...DB,
      notifications: DB.notifications.map((n) =>
        n.id === notif.id ? { ...n, lu: true, luLe: nowISO } : n
      ),
    };
    setDB(updated);
    saveDB(updated);
  };

  const toutMarquerCommeLu = () => {
    if (nonLues.length === 0) return;
    const nowISO = new Date().toISOString();
    const mesIds = new Set(mesNotifications.map((n) => n.id));
    const updated = {
      ...DB,
      notifications: DB.notifications.map((n) =>
        mesIds.has(n.id) && !n.lu ? { ...n, lu: true, luLe: nowISO } : n
      ),
    };
    setDB(updated);
    saveDB(updated);
  };

  if (!currentUser) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" title="Notifications">
          <Bell className="w-4 h-4" />
          {nonLues.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {nonLues.length > 9 ? "9+" : nonLues.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <p className="text-sm font-semibold">Notifications</p>
          {nonLues.length > 0 && (
            <button onClick={toutMarquerCommeLu} className="text-xs text-primary hover:underline flex items-center gap-1">
              <CheckCheck className="w-3.5 h-3.5" /> Tout marquer lu
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto divide-y">
          {mesNotifications.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8 px-3">Aucune notification</p>
          ) : (
            mesNotifications.map((n) => (
              <div key={n.id} className={`px-3 py-2.5 text-sm ${!n.lu ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{n.expediteurNom}</p>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDateTime(n.date)}</span>
                </div>
                <p className="text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{n.message}</p>
                {(n.clientNom || n.montant) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {n.clientNom && <>Client : <span className="font-medium">{n.clientNom}</span></>}
                    {n.montant ? <> — {fmt(n.montant)}</> : null}
                  </p>
                )}
                {!n.lu && (
                  <button onClick={() => marquerCommeLu(n)} className="mt-1.5 text-xs text-primary hover:underline flex items-center gap-1">
                    <Check className="w-3 h-3" /> Marquer comme lu
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
