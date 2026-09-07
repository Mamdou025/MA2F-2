import { useState, useMemo, useEffect, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmtDate, fmt, todayLocal } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, HardDrive, Clock, CheckCircle, AlertTriangle, Trash2, RotateCcw, Shield, Cloud, CloudOff, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { db, collection, query, orderBy, limit, getDocs, doc, setDoc, deleteDoc, getDoc, functions, httpsCallable, storage, ref, uploadString, getBytes, deleteObject } from "@/lib/firebase";

const MAX_BACKUPS = 30; // Garder les 30 dernières sauvegardes
// Préfixe Firebase Storage où le JSON complet de chaque sauvegarde est
// uploadé (voir uploadBackupToStorage) — depuis le correctif du 2026-09-04,
// le document Firestore backups/<id> ne garde plus qu'un pointeur vers ce
// chemin, jamais le JSON lui-même (voir le commentaire sur Backup.data dans
// types.ts pour l'historique complet du bug que ça corrige).
const BACKUPS_STORAGE_PREFIX = "backups_json";

async function uploadBackupToStorage(id: string, data: string): Promise<string> {
  const path = `${BACKUPS_STORAGE_PREFIX}/${id}.json`;
  await uploadString(ref(storage, path), data, "raw", { contentType: "application/json" });
  return path;
}

async function deleteBackupFromStorage(path: string): Promise<void> {
  try {
    await deleteObject(ref(storage, path));
  } catch (e: any) {
    // "object-not-found" est normal si le fichier a déjà été supprimé (ex:
    // double-clic, ou entrée déjà purgée par la rotation) — pas une vraie erreur.
    if (e?.code !== "storage/object-not-found") console.error("Erreur suppression sauvegarde Storage:", e);
  }
}

// Récupère le JSON complet d'une sauvegarde, quel que soit son format :
// - format historique (avant le 2026-09-04) : `data` est déjà inline, rien à
//   télécharger (c'est aussi le cas pour TOUTE sauvegarde encore présente
//   dans l'état local de l'onglet qui l'a créée, même au format actuel —
//   `data` n'est absent que pour les sauvegardes reçues via le listener
//   Firestore d'un autre onglet/session, voir setupFirestoreSync).
// - format actuel : le JSON est sur Firebase Storage, à `storagePath`.
async function getBackupData(backup: { data?: string; storagePath?: string }): Promise<string> {
  if (backup.data) return backup.data;
  if (backup.storagePath) {
    const bytes = await getBytes(ref(storage, backup.storagePath));
    return new TextDecoder().decode(bytes);
  }
  throw new Error("Sauvegarde introuvable (ni données locales, ni fichier Storage).");
}

async function syncBackupToFirestore(backup: { id: string; date: string; type: string; taille: number; data: string }): Promise<"ok" | "error"> {
  try {
    const storagePath = await uploadBackupToStorage(backup.id, backup.data);
    // Document Firestore volontairement léger : uniquement les métadonnées +
    // le pointeur Storage, jamais le JSON complet — voir BACKUPS_STORAGE_PREFIX
    // ci-dessus et le commentaire sur Backup.data dans types.ts.
    await setDoc(doc(db, "backups", backup.id), {
      id: backup.id,
      date: backup.date,
      type: backup.type,
      taille: backup.taille,
      storagePath,
    });
    return "ok";
  } catch (e) {
    console.error("Erreur sync sauvegarde (Storage/Firestore):", e);
    return "error";
  }
}

async function deleteBackupFromFirestore(id: string): Promise<void> {
  try { await deleteDoc(doc(db, "backups", id)); } catch (e) { console.error("Erreur suppression sauvegarde Firestore:", e); }
}

// IMPORTANT : une sauvegarde ne doit JAMAIS embarquer le tableau DB.backups
// lui-même. Sinon chaque nouvelle sauvegarde contient une copie de toutes
// les précédentes (qui elles-mêmes en contenaient déjà...), et la taille du
// document Firestore/localStorage explose de façon quasi quadratique au fil
// du temps — jusqu'à dépasser la limite de 1 Mo par document Firestore et
// faire échouer silencieusement la sauvegarde. On exclut donc `backups` du
// snapshot ; à la restauration, les sauvegardes actuelles sont de toute façon
// préservées (voir handleRestore).
function snapshotSansBackups(db: any): string {
  return JSON.stringify({ ...db, backups: [] });
}

export default function BackupsSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [triggeringDrive, setTriggeringDrive] = useState(false);
  const [triggeringJson, setTriggeringJson] = useState(false);

  const isAdmin = currentUser?.role === "admin" || currentUser?.roles?.includes("admin");

  // ─── Statut de la sauvegarde cloud (Google Drive, via Cloud Function) ────────
  // Best-effort : la collection backup_logs n'est lisible que par un admin
  // (règle Firestore), et seulement si la Cloud Function dailyBackupToGoogleDrive
  // est bien déployée et a déjà tourné au moins une fois. En cas d'échec de
  // lecture (règles pas encore déployées, pas de custom claim, aucune fonction
  // déployée...), on affiche un statut "inconnu" plutôt que de planter.
  type DriveStatus = "loading" | "ok" | "stale" | "error" | "unknown";
  const [driveStatus, setDriveStatus] = useState<DriveStatus>("loading");
  const [driveLastLog, setDriveLastLog] = useState<{ date: Date | null; status: string; fileName?: string; downloadUrl?: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) { setDriveStatus("unknown"); return; }
    let cancelled = false;
    (async () => {
      try {
        const q = query(collection(db, "backup_logs"), orderBy("date", "desc"), limit(1));
        const snap = await getDocs(q);
        if (cancelled) return;
        if (snap.empty) { setDriveStatus("unknown"); return; }
        const d = snap.docs[0].data() as any;
        const date: Date | null = d.date?.toDate ? d.date.toDate() : (d.date ? new Date(d.date) : null);
        setDriveLastLog({ date, status: d.status || "?", fileName: d.fileName, downloadUrl: d.downloadUrl });
        const ageMs = date ? Date.now() - date.getTime() : Infinity;
        if (d.status === "error") setDriveStatus("error");
        else if (ageMs > 48 * 3600 * 1000) setDriveStatus("stale");
        else setDriveStatus("ok");
      } catch {
        if (!cancelled) setDriveStatus("unknown");
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Nettoyage ponctuel des sauvegardes déjà polluées par l'ancien bug
  // d'auto-inclusion (sauvegardes créées avant ce correctif, qui embarquent
  // récursivement toutes les sauvegardes précédentes). On les réduit à leur
  // contenu utile sans changer leur date/type, pour faire retomber la taille
  // du document sans perdre l'historique.
  useEffect(() => {
    const bloated = DB.backups.filter((b) => {
      if (!b.data) return false; // format actuel (Storage) : jamais concerné par ce bug historique
      try { return JSON.parse(b.data)?.backups?.length > 0; } catch { return false; }
    });
    if (bloated.length === 0) return;
    const cleaned = DB.backups.map((b) => {
      if (!b.data) return b;
      try {
        const parsed = JSON.parse(b.data);
        if (!parsed?.backups?.length) return b;
        const data = JSON.stringify({ ...parsed, backups: [] });
        return { ...b, data, taille: data.length };
      } catch { return b; }
    });
    const updated = { ...DB, backups: cleaned };
    setDB(updated); saveDB(updated);
    logActivity("update", "Sauvegarde", `Nettoyage de ${bloated.length} sauvegarde(s) auto-incluse(s)`);
    // Ré-écrire chaque sauvegarde nettoyée dans son propre document Firestore
    cleaned.forEach((b) => { if (b.data && bloated.some((x) => x.id === b.id)) syncBackupToFirestore(b as { id: string; date: string; type: string; taille: number; data: string }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Nettoyage ponctuel de l'ancien document unique "backups/data" (ancienne
  // architecture, désormais abandonnée) — il peut dépasser 1 Mo et n'est plus
  // jamais lu ; on le supprime une fois pour ne pas laisser de données mortes.
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const legacyRef = doc(db, "backups", "data");
        const snap = await getDoc(legacyRef);
        if (snap.exists()) await deleteDoc(legacyRef);
      } catch { /* best-effort, pas grave si ça échoue */ }
    })();
  }, [isAdmin]);

  // Sauvegarde automatique quotidienne
  useEffect(() => {
    const checkAutoBackup = () => {
      const autoEnabled = DB.params.autoBackup !== false; // Activé par défaut
      if (!autoEnabled) return;

      const today = todayLocal();
      const hasBackupToday = DB.backups.some((b) => b.date.startsWith(today) && b.type === "Automatique");

      if (!hasBackupToday && DB.ventes.length > 0) {
        // Créer une sauvegarde automatique
        const data = snapshotSansBackups(DB);
        const backup = {
          id: uid(),
          date: new Date().toISOString(),
          type: "Automatique",
          taille: data.length,
          data,
        };
        // Limiter le nombre de sauvegardes — supprimer aussi côté Firestore
        // celles qu'on retire localement pour ne pas laisser de doublons.
        const backupsAvant = DB.backups;
        const backups = [...backupsAvant, backup].slice(-MAX_BACKUPS);
        const retirees = backupsAvant.filter((b) => !backups.some((x) => x.id === b.id));
        const updated = { ...DB, backups };
        setDB(updated);
        saveDB(updated);
        syncBackupToFirestore(backup);
        retirees.forEach((b) => { deleteBackupFromFirestore(b.id); if (b.storagePath) deleteBackupFromStorage(b.storagePath); });
      }
    };

    checkAutoBackup();
    // Vérifier toutes les heures
    const interval = setInterval(checkAutoBackup, 3600000);
    return () => clearInterval(interval);
    // Dépendances volontairement précises (pas [] figé au montage) : sans
    // elles, ce useEffect ne s'exécutait qu'une seule fois avec l'état
    // Firestore encore incomplet (avant que le listener temps réel ait livré
    // DB.backups), ce qui faisait croire à tort qu'aucune sauvegarde
    // automatique n'existait pour aujourd'hui — créant un doublon à CHAQUE
    // montage du composant (2026-09-05, diagnostiqué via de nombreuses
    // sauvegardes "Automatique" en double portant des horodatages à
    // quelques secondes d'intervalle). Désormais, la vérification se
    // relance dès que DB.backups/DB.ventes/le réglage autoBackup changent
    // réellement, donc une fois les données synchronisées elle voit l'état
    // à jour et ne recrée rien en double.
  }, [DB.backups, DB.ventes, DB.params.autoBackup]);

  const handleBackup = async () => {
    const data = snapshotSansBackups(DB);
    const backup = { id: uid(), date: new Date().toISOString(), type: "Manuel", taille: data.length, data };
    const backupsAvant = DB.backups;
    const backups = [...backupsAvant, backup].slice(-MAX_BACKUPS);
    const retirees = backupsAvant.filter((b) => !backups.some((x) => x.id === b.id));
    const updated = { ...DB, backups };
    setDB(updated); saveDB(updated);
    logActivity("create", "Sauvegarde", "Sauvegarde manuelle");
    const result = await syncBackupToFirestore(backup);
    retirees.forEach((b) => { deleteBackupFromFirestore(b.id); if (b.storagePath) deleteBackupFromStorage(b.storagePath); });
    if (result === "error") {
      toast.warning("Sauvegarde créée localement — la synchronisation cloud a échoué, elle sera retentée plus tard.");
    } else {
      toast.success("Sauvegarde créée");
    }
  };

  // Déclenche la vraie sauvegarde Excel -> Cloud Storage (Cloud Function
  // `manualBackup`), sans attendre le déclenchement automatique de 23h.
  // Utile pour tester que le pipeline complet fonctionne, sans passer par la
  // console Firebase.
  const handleTriggerDriveBackup = async () => {
    if (triggeringDrive) return;
    setTriggeringDrive(true);
    try {
      const call = httpsCallable(functions, "manualBackup");
      const result: any = await call({});
      logActivity("create", "Sauvegarde", "Sauvegarde cloud déclenchée manuellement");
      const url = result?.data?.downloadUrl;
      toast.success(
        `Sauvegarde créée : ${result?.data?.fileName || "fichier envoyé"}${url ? "" : ""}`,
        url ? { action: { label: "Télécharger", onClick: () => window.open(url, "_blank") } } : undefined
      );
    } catch (e: any) {
      console.error("Erreur manualBackup:", e);
      toast.error(`Échec de la sauvegarde cloud : ${e?.message || "fonction indisponible"}. Vérifiez qu'elle est bien déployée (dailyBackupToGoogleDrive/manualBackup).`);
    } finally {
      setTriggeringDrive(false);
    }
  };

  // Déclenche la sauvegarde JSON restaurable côté serveur (Cloud Function
  // `manualJsonBackup`, ajoutée le 2026-09-05 — voir CLAUDE.md) sans attendre
  // le déclenchement automatique de 23h20. Contrairement à
  // handleTriggerDriveBackup ci-dessus (Excel, pas restaurable), le résultat
  // de celle-ci apparaît directement dans le tableau ci-dessous (écrit dans
  // la même collection Firestore "backups" que "Sauvegarde manuelle") — pas
  // besoin de mettre à jour l'état local ici, le listener s'en charge.
  const handleTriggerJsonBackup = async () => {
    if (triggeringJson) return;
    setTriggeringJson(true);
    try {
      const call = httpsCallable(functions, "manualJsonBackup");
      const result: any = await call({});
      if (result?.data?.id) {
        logActivity("create", "Sauvegarde", "Sauvegarde JSON restaurable déclenchée manuellement (serveur)");
        toast.success(`Sauvegarde restaurable créée sur le serveur (${((result.data.taille || 0) / 1024).toFixed(1)} Ko)`);
      } else {
        toast.info("Une sauvegarde restaurable existe déjà pour aujourd'hui — rien de nouveau créé.");
      }
    } catch (e: any) {
      console.error("Erreur manualJsonBackup:", e);
      toast.error(`Échec de la sauvegarde restaurable côté serveur : ${e?.message || "fonction indisponible"}. Vérifiez qu'elle est bien déployée (dailyJsonBackup/manualJsonBackup).`);
    } finally {
      setTriggeringJson(false);
    }
  };

  const handleDownload = async (id: string) => {
    const backup = DB.backups.find((b) => b.id === id); if (!backup) return;
    try {
      const data = await getBackupData(backup);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `MA2F_backup_${backup.date.split("T")[0]}.json`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Fichier téléchargé");
    } catch (e) {
      toast.error(`Impossible de récupérer cette sauvegarde : ${(e as Error).message}`);
    }
  };

  const handleDownloadAll = () => {
    const data = JSON.stringify(DB, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `MA2F_export_complet_${todayLocal()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Export complet téléchargé");
  };

  const handleRestore = async (id: string) => {
    const backup = DB.backups.find((b) => b.id === id); if (!backup) return;
    try {
      const raw = await getBackupData(backup);
      const data = JSON.parse(raw);
      // Garder les backups actuels
      data.backups = DB.backups;
      setDB(data); saveDB(data);
      logActivity("restore", "Sauvegarde", `Restauration du ${fmtDate(backup.date)}`);
      toast.success("Base restaurée avec succès");
    } catch (e) { toast.error(`Erreur de restauration : ${(e as Error).message}`); }
  };

  // Test de restauration (vérifie l'intégrité sans restaurer)
  const handleTestRestore = async (id: string) => {
    const backup = DB.backups.find((b) => b.id === id); if (!backup) return;
    try {
      const raw = await getBackupData(backup);
      const data = JSON.parse(raw);
      // Vérifier les champs essentiels
      const checks = [
        { field: "ventes", ok: Array.isArray(data.ventes) },
        { field: "clients", ok: Array.isArray(data.clients) },
        { field: "production", ok: Array.isArray(data.production) },
        { field: "depenses", ok: Array.isArray(data.depenses) },
        { field: "recouvrements", ok: Array.isArray(data.recouvrements) },
        { field: "params", ok: typeof data.params === "object" },
        { field: "users", ok: Array.isArray(data.users) },
      ];
      const failed = checks.filter((c) => !c.ok);
      if (failed.length === 0) {
        setTestResult({ success: true, message: `Test réussi — ${data.ventes.length} ventes, ${data.clients.length} clients, ${data.production.length} productions. Données intègres.` });
        toast.success("Test de restauration réussi");
      } else {
        setTestResult({ success: false, message: `Champs manquants ou corrompus: ${failed.map(f => f.field).join(", ")}` });
        toast.error("Test échoué — données corrompues");
      }
    } catch (e) {
      setTestResult({ success: false, message: `Erreur de parsing JSON: ${(e as Error).message}` });
      toast.error("Test échoué — fichier corrompu");
    }
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const backup = DB.backups.find((b) => b.id === deleteId);
    const updated = { ...DB, backups: DB.backups.filter((b) => b.id !== deleteId) };
    setDB(updated); saveDB(updated);
    deleteBackupFromFirestore(deleteId);
    if (backup?.storagePath) deleteBackupFromStorage(backup.storagePath);
    logActivity("delete", "Sauvegarde", "Suppression d'une sauvegarde");
    toast.success("Sauvegarde supprimée");
    setDeleteId(null);
  };

  const toggleAutoBackup = () => {
    const updated = { ...DB, params: { ...DB.params, autoBackup: !(DB.params.autoBackup !== false) } };
    setDB(updated); saveDB(updated);
    const enabled = updated.params.autoBackup !== false;
    logActivity("update", "Sauvegarde", enabled ? "Sauvegarde automatique activée" : "Sauvegarde automatique désactivée");
    toast.success(enabled ? "Sauvegarde automatique activée" : "Sauvegarde automatique désactivée");
  };

  // Stats
  const stats = useMemo(() => {
    const auto = DB.backups.filter((b) => b.type === "Automatique").length;
    const manual = DB.backups.filter((b) => b.type === "Manuel").length;
    const lastBackup = DB.backups.length > 0 ? DB.backups[DB.backups.length - 1] : null;
    const totalSize = DB.backups.reduce((s, b) => s + b.taille, 0);
    const lastBackupAgeH = lastBackup ? (Date.now() - new Date(lastBackup.date).getTime()) / 3600000 : Infinity;
    return { auto, manual, total: DB.backups.length, lastBackup, totalSize, lastBackupAgeH };
  }, [DB.backups]);

  const localStale = DB.ventes.length > 0 && stats.lastBackupAgeH > 48;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#1B4B6B]">Sauvegardes</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.total} sauvegarde(s) — {(stats.totalSize / 1024 / 1024).toFixed(2)} Mo total
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleDownloadAll}>
            <Download className="w-4 h-4 mr-2" /> Export complet
          </Button>
          <Button onClick={handleBackup} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
            <HardDrive className="w-4 h-4 mr-2" /> Sauvegarde manuelle
          </Button>
          {isAdmin && (
            <Button variant="outline" onClick={handleTriggerDriveBackup} disabled={triggeringDrive} className="border-green-600 text-green-700 hover:bg-green-50">
              <Cloud className="w-4 h-4 mr-2" /> {triggeringDrive ? "Envoi en cours..." : "Sauvegarde cloud maintenant"}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" onClick={handleTriggerJsonBackup} disabled={triggeringJson} className="border-blue-600 text-blue-700 hover:bg-blue-50" title="Sauvegarde restaurable, générée par le serveur — sans attendre le déclenchement automatique de 23h20">
              <HardDrive className="w-4 h-4 mr-2" /> {triggeringJson ? "Envoi en cours..." : "Sauvegarde restaurable serveur"}
            </Button>
          )}
        </div>
      </div>

      {/* Alertes de fraîcheur / échec */}
      {(localStale || driveStatus === "error" || driveStatus === "stale" || driveStatus === "unknown") && (
        <div className="space-y-2">
          {localStale && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Aucune sauvegarde depuis {Math.floor(stats.lastBackupAgeH / 24)} jour(s). Une sauvegarde restaurable est censée être générée automatiquement chaque nuit par le serveur (23h20, indépendamment de cette page) — si ce message persiste plusieurs jours, vérifiez que la Cloud Function `dailyJsonBackup` est bien déployée et tourne sans erreur, ou faites une sauvegarde manuelle maintenant.</span>
            </div>
          )}
          {isAdmin && driveStatus === "error" && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <CloudOff className="w-4 h-4 mt-0.5 shrink-0" />
              <span>La dernière sauvegarde cloud (Cloud Storage) a échoué{driveLastLog?.date ? ` le ${fmtDate(driveLastLog.date.toISOString())}` : ""}. Vérifiez la Cloud Function `dailyBackupToGoogleDrive` dans la console Firebase.</span>
            </div>
          )}
          {isAdmin && driveStatus === "stale" && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <Cloud className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Dernière sauvegarde cloud (Cloud Storage) enregistrée {driveLastLog?.date ? `le ${fmtDate(driveLastLog.date.toISOString())}` : "il y a longtemps"} — plus de 48h. Vérifiez que la sauvegarde quotidienne tourne toujours.</span>
            </div>
          )}
          {isAdmin && driveStatus === "unknown" && (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Statut de la sauvegarde cloud (Cloud Storage) inconnu — aucun journal accessible. Cela peut signifier qu'elle n'a jamais tourné, ou que la configuration Firebase n'est pas complète.</span>
            </div>
          )}
        </div>
      )}
      {isAdmin && driveStatus === "ok" && driveLastLog?.date && (
        <div className="flex items-center gap-2 text-xs text-green-700">
          <Cloud className="w-3.5 h-3.5" /> Sauvegarde cloud (Cloud Storage) à jour — dernière le {fmtDate(driveLastLog.date.toISOString())}
          {driveLastLog.downloadUrl && (
            <a href={driveLastLog.downloadUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-900">
              Télécharger le fichier
            </a>
          )}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Automatiques</p>
            <p className="text-2xl font-bold text-green-700">{stats.auto}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Manuelles</p>
            <p className="text-2xl font-bold text-blue-700">{stats.manual}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Dernière sauvegarde</p>
            <p className="text-sm font-medium">
              {stats.lastBackup ? new Date(stats.lastBackup.date).toLocaleDateString("fr-FR") : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Espace utilisé</p>
            <p className="text-2xl font-bold">{(stats.totalSize / 1024 / 1024).toFixed(1)} Mo</p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" /> Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Sauvegarde automatique quotidienne (dans ce navigateur)</p>
              <p className="text-sm text-muted-foreground">En plus de la sauvegarde serveur (23h20, toujours active) : une sauvegarde supplémentaire est créée si un admin a cette page ouverte</p>
            </div>
            <Switch
              checked={DB.params.autoBackup !== false}
              onCheckedChange={toggleAutoBackup}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Rétention</p>
              <p className="text-sm text-muted-foreground">Les {MAX_BACKUPS} dernières sauvegardes sont conservées</p>
            </div>
            <Badge variant="secondary">{MAX_BACKUPS} max</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Test de restauration */}
      {testResult && (
        <Card className={testResult.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              {testResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              )}
              <div>
                <p className={`font-medium ${testResult.success ? "text-green-800" : "text-red-800"}`}>
                  {testResult.success ? "Test de restauration réussi" : "Test de restauration échoué"}
                </p>
                <p className={`text-sm mt-1 ${testResult.success ? "text-green-700" : "text-red-700"}`}>
                  {testResult.message}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTestResult(null)}>
                Fermer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tableau des sauvegardes */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Taille</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DB.backups.length > 0 ? [...DB.backups].reverse().map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{new Date(b.date).toLocaleString("fr-FR")}</TableCell>
                    <TableCell>
                      <Badge variant={b.type === "Automatique" ? "secondary" : "default"} className={b.type === "Automatique" ? "bg-green-100 text-green-800" : ""}>
                        {b.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{(b.taille / 1024).toFixed(1)} Ko</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => handleDownload(b.id)} title="Télécharger">
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleTestRestore(b.id)} title="Tester l'intégrité" className="text-blue-600">
                          <Shield className="w-3 h-3" />
                        </Button>
                        {isAdmin && (
                          <>
                            <Button variant="outline" size="sm" className="text-green-600" onClick={() => handleRestore(b.id)} title="Restaurer">
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-600" onClick={() => setDeleteId(b.id)} title="Supprimer">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Aucune sauvegarde. Cliquez sur "Sauvegarde manuelle" pour en créer une.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        onConfirm={confirmDelete}
        title="Supprimer la sauvegarde"
        description="Cette action est irréversible. Voulez-vous vraiment supprimer cette sauvegarde ?"
      />
    </div>
  );
}
