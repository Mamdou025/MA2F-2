/**
 * Section Historique des Modifications — MA2F AquaSachet
 * Interface améliorée pour consulter l'historique complet des modifications
 */
import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  History, Search, ArrowRight, Plus, Pencil, Trash2, Calendar, User, Filter,
  ChevronDown, ChevronUp, Clock, FileText, X, Eye, AlertCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtDate, todayLocal, toLocalDateStr } from "@/lib/helpers";
import type { HistoryEntry } from "@/lib/types";

const ACTION_LABELS: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  create: { label: "Création", color: "text-green-800", bgColor: "bg-green-100 border-green-200", icon: <Plus className="h-3 w-3" /> },
  update: { label: "Modification", color: "text-blue-800", bgColor: "bg-blue-100 border-blue-200", icon: <Pencil className="h-3 w-3" /> },
  delete: { label: "Suppression", color: "text-red-800", bgColor: "bg-red-100 border-red-200", icon: <Trash2 className="h-3 w-3" /> },
};

const MODULE_OPTIONS = [
  { value: "all", label: "Tous les modules" },
  { value: "Ventes", label: "Ventes" },
  { value: "Production", label: "Production" },
  { value: "Dépenses", label: "Dépenses" },
  { value: "Clients", label: "Clients" },
  { value: "Commerciaux", label: "Commerciaux" },
  { value: "Livreurs", label: "Livreurs" },
  { value: "Recouvrements", label: "Recouvrements" },
  { value: "Réception rouleaux", label: "Réception rouleaux" },
  { value: "Maintenance", label: "Maintenance" },
  { value: "Versements", label: "Versements" },
  { value: "Véhicules", label: "Véhicules" },
  { value: "Paramètres", label: "Paramètres" },
  { value: "Stock", label: "Stock" },
  { value: "Clôture", label: "Clôture" },
];

// Helpers de dates
const todayStr = () => todayLocal();
const startOfWeek = () => {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
  return toLocalDateStr(d);
};
const startOfMonth = () => {
  const d = new Date(); d.setDate(1);
  return toLocalDateStr(d);
};

type PeriodFilter = "today" | "week" | "month" | "all" | "custom";

export default function HistoriqueSection() {
  const { DB } = useApp();
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("month");
  const [dateStart, setDateStart] = useState(startOfMonth());
  const [dateEnd, setDateEnd] = useState(todayStr());
  const [page, setPage] = useState(1);
  const [openDetail, setOpenDetail] = useState<HistoryEntry | null>(null);
  const perPage = 25;

  // Extraire la liste des utilisateurs uniques
  const uniqueUsers = useMemo(() => {
    const users = new Set<string>();
    (DB.history || []).forEach(h => { if (h.userName) users.add(h.userName); });
    return Array.from(users).sort();
  }, [DB.history]);

  // Calcul des dates de filtre
  const dateRange = useMemo(() => {
    switch (periodFilter) {
      case "today": return { start: todayStr(), end: todayStr() };
      case "week": return { start: startOfWeek(), end: todayStr() };
      case "month": return { start: startOfMonth(), end: todayStr() };
      case "custom": return { start: dateStart, end: dateEnd };
      default: return { start: "", end: "" };
    }
  }, [periodFilter, dateStart, dateEnd]);

  const history = useMemo(() => {
    // (b.timestamp || "") : même filet que sur la page Stock — une entrée
    // d'historique sans timestamp ferait planter tout l'onglet sinon.
    let items = [...(DB.history || [])].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

    // Filtre par période
    if (periodFilter !== "all" && dateRange.start) {
      items = items.filter(h => {
        const d = h.timestamp.split("T")[0];
        return d >= dateRange.start && d <= dateRange.end;
      });
    }

    // Filtre par module
    if (moduleFilter !== "all") {
      items = items.filter((h) => h.module === moduleFilter);
    }

    // Filtre par action
    if (actionFilter !== "all") {
      items = items.filter((h) => h.action === actionFilter);
    }

    // Filtre par utilisateur
    if (userFilter !== "all") {
      items = items.filter((h) => h.userName === userFilter);
    }

    // Recherche textuelle
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (h) =>
          h.entityLabel.toLowerCase().includes(q) ||
          h.userName.toLowerCase().includes(q) ||
          h.module.toLowerCase().includes(q) ||
          (h.motif && h.motif.toLowerCase().includes(q)) ||
          h.changes.some(
            (c) =>
              c.field.toLowerCase().includes(q) ||
              c.oldValue.toLowerCase().includes(q) ||
              c.newValue.toLowerCase().includes(q)
          )
      );
    }

    return items;
  }, [DB.history, moduleFilter, actionFilter, userFilter, periodFilter, dateRange, search]);

  const totalPages = Math.ceil(history.length / perPage);
  const paginatedHistory = history.slice((page - 1) * perPage, page * perPage);

  // Statistiques
  const stats = useMemo(() => {
    const all = DB.history || [];
    const filtered = history;
    return {
      total: all.length,
      filtered: filtered.length,
      creates: filtered.filter(h => h.action === "create").length,
      updates: filtered.filter(h => h.action === "update").length,
      deletes: filtered.filter(h => h.action === "delete").length,
      modules: new Set(filtered.map(h => h.module)).size,
      users: new Set(filtered.map(h => h.userName)).size,
    };
  }, [DB.history, history]);

  // Activité par jour (mini timeline)
  const activityByDay = useMemo(() => {
    const days: Record<string, number> = {};
    history.slice(0, 500).forEach(h => {
      const d = h.timestamp.split("T")[0];
      days[d] = (days[d] || 0) + 1;
    });
    return Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  }, [history]);

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    } catch {
      return ts;
    }
  };

  const resetFilters = () => {
    setSearch("");
    setModuleFilter("all");
    setActionFilter("all");
    setUserFilter("all");
    setPeriodFilter("month");
    setPage(1);
  };

  const hasActiveFilters = search || moduleFilter !== "all" || actionFilter !== "all" || userFilter !== "all" || periodFilter !== "month";

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Historique des Modifications</h2>
          <p className="text-sm text-gray-500">Traçabilité complète : ancienne valeur, nouvelle valeur, utilisateur et motif</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs gap-1">
            <History className="w-3 h-3" />
            {(DB.history || []).length} entrées totales
          </Badge>
        </div>
      </div>

      {/* Filtres */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="space-y-3">
            {/* Ligne 1 : Période + Recherche */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {([
                  { id: "today", label: "Aujourd'hui" },
                  { id: "week", label: "Semaine" },
                  { id: "month", label: "Mois" },
                  { id: "all", label: "Tout" },
                  { id: "custom", label: "Personnalisé" },
                ] as { id: PeriodFilter; label: string }[]).map(p => (
                  <button key={p.id} onClick={() => { setPeriodFilter(p.id); setPage(1); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${periodFilter === p.id ? "bg-white shadow-sm text-[#1B4B6B]" : "text-gray-600 hover:text-gray-900"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Rechercher (entité, utilisateur, valeur, motif...)"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Dates personnalisées */}
            {periodFilter === "custom" && (
              <div className="flex gap-3 items-center">
                <Calendar className="w-4 h-4 text-gray-400" />
                <Input type="date" value={dateStart} onChange={e => { setDateStart(e.target.value); setPage(1); }} className="w-40" />
                <span className="text-gray-400">→</span>
                <Input type="date" value={dateEnd} onChange={e => { setDateEnd(e.target.value); setPage(1); }} className="w-40" />
              </div>
            )}

            {/* Ligne 2 : Filtres détaillés */}
            <div className="flex flex-wrap gap-3 items-center">
              <Filter className="w-4 h-4 text-gray-400" />
              <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(1); }}>
                <SelectTrigger className="w-44 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODULE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
                <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes actions</SelectItem>
                  <SelectItem value="create">Créations</SelectItem>
                  <SelectItem value="update">Modifications</SelectItem>
                  <SelectItem value="delete">Suppressions</SelectItem>
                </SelectContent>
              </Select>
              <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); setPage(1); }}>
                <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="Tous utilisateurs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous utilisateurs</SelectItem>
                  {uniqueUsers.map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs text-gray-500 gap-1">
                  <X className="w-3 h-3" /> Réinitialiser
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistiques */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-gradient-to-br from-gray-50 to-white">
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-xl font-bold text-gray-900">{stats.filtered}</p>
            <p className="text-xs text-gray-500">Résultats</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-white border-green-100">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Plus className="w-4 h-4 text-green-600" />
              <p className="text-xl font-bold text-green-700">{stats.creates}</p>
            </div>
            <p className="text-xs text-gray-500">Créations</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Pencil className="w-4 h-4 text-blue-600" />
              <p className="text-xl font-bold text-blue-700">{stats.updates}</p>
            </div>
            <p className="text-xs text-gray-500">Modifications</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-white border-red-100">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Trash2 className="w-4 h-4 text-red-600" />
              <p className="text-xl font-bold text-red-700">{stats.deletes}</p>
            </div>
            <p className="text-xs text-gray-500">Suppressions</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-100">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <User className="w-4 h-4 text-purple-600" />
              <p className="text-xl font-bold text-purple-700">{stats.users}</p>
            </div>
            <p className="text-xs text-gray-500">Utilisateurs</p>
          </CardContent>
        </Card>
      </div>

      {/* Mini timeline d'activité */}
      {activityByDay.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-600 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Activité récente par jour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-16">
              {activityByDay.map(([day, count]) => {
                const maxCount = Math.max(...activityByDay.map(([, c]) => c));
                const height = Math.max(8, (count / maxCount) * 100);
                return (
                  <div key={day} className="flex flex-col items-center flex-1 gap-1">
                    <span className="text-xs font-medium text-gray-700">{count}</span>
                    <div
                      className="w-full bg-[#1B4B6B]/20 rounded-t transition-all hover:bg-[#1B4B6B]/40"
                      style={{ height: `${height}%`, minHeight: "4px" }}
                    />
                    <span className="text-[10px] text-gray-400">
                      {new Date(day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste des modifications */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-5 w-5 text-[#1B4B6B]" />
              Modifications ({history.length})
            </CardTitle>
            {history.length > 0 && (
              <span className="text-xs text-gray-400">
                Page {page}/{totalPages}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {paginatedHistory.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 font-medium">
                {(DB.history || []).length === 0
                  ? "Aucune modification enregistrée"
                  : "Aucun résultat pour ces filtres"}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {(DB.history || []).length === 0
                  ? "L'historique se remplira automatiquement à chaque action."
                  : "Essayez de modifier vos critères de recherche."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedHistory.map((entry) => (
                <HistoryCard key={entry.id} entry={entry} onViewDetail={() => setOpenDetail(entry)} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                Précédent
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded text-sm font-medium transition-all ${
                        page === pageNum
                          ? "bg-[#1B4B6B] text-white"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
              >
                Suivant
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Détail */}
      <Dialog open={!!openDetail} onOpenChange={() => setOpenDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-[#1B4B6B]" />
              Détail de la modification
            </DialogTitle>
          </DialogHeader>
          {openDetail && (
            <div className="space-y-4">
              {/* Infos générales */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Action</p>
                  <Badge className={`${ACTION_LABELS[openDetail.action]?.bgColor || ""} gap-1 mt-1`}>
                    {ACTION_LABELS[openDetail.action]?.icon}
                    {ACTION_LABELS[openDetail.action]?.label || openDetail.action}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Module</p>
                  <p className="font-medium mt-1">{openDetail.module}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Entité</p>
                  <p className="font-medium mt-1">{openDetail.entityLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Utilisateur</p>
                  <div className="flex items-center gap-1 mt-1">
                    <User className="w-3 h-3 text-gray-400" />
                    <p className="font-medium">{openDetail.userName}</p>
                  </div>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Date et heure</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <p className="font-medium">{formatTimestamp(openDetail.timestamp)}</p>
                  </div>
                </div>
              </div>

              {/* Motif */}
              {openDetail.motif && (
                <div className="border-t pt-3">
                  <p className="text-xs text-gray-500 mb-1">Motif de modification</p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-800">{openDetail.motif}</p>
                  </div>
                </div>
              )}

              {/* Changements détaillés */}
              {openDetail.changes.length > 0 && (
                <div className="border-t pt-3">
                  <p className="text-xs text-gray-500 mb-3">Changements ({openDetail.changes.length} champ{openDetail.changes.length > 1 ? "s" : ""})</p>
                  <div className="space-y-2">
                    {openDetail.changes.map((change, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-600 mb-2">{change.field}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {change.oldValue && (
                            <span className="bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded text-xs font-mono line-through">
                              {change.oldValue}
                            </span>
                          )}
                          {change.oldValue && change.newValue && change.newValue !== "(supprimé)" && (
                            <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
                          )}
                          {change.newValue && (
                            <span className={`px-2 py-1 rounded text-xs font-mono border ${
                              change.newValue === "(supprimé)"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-green-50 text-green-700 border-green-200"
                            }`}>
                              {change.newValue}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ID technique */}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-500">ID de l'entrée</p>
                <p className="text-xs font-mono text-gray-400 mt-1">{openDetail.id}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDetail(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryCard({ entry, onViewDetail }: { entry: HistoryEntry; onViewDetail: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const actionInfo = ACTION_LABELS[entry.action] || ACTION_LABELS.update;

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    } catch {
      return ts;
    }
  };

  return (
    <div className="border rounded-lg hover:border-[#1B4B6B]/30 transition-all group">
      {/* Ligne principale */}
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {/* Date/Heure */}
        <div className="text-center min-w-[52px]">
          <p className="text-xs font-medium text-gray-700">{formatDate(entry.timestamp)}</p>
          <p className="text-[10px] text-gray-400">{formatTime(entry.timestamp)}</p>
        </div>

        {/* Séparateur */}
        <div className="w-px h-8 bg-gray-200" />

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${actionInfo.bgColor} ${actionInfo.color} gap-1 text-xs border`}>
              {actionInfo.icon}
              {actionInfo.label}
            </Badge>
            <span className="font-medium text-sm text-gray-900 truncate">{entry.entityLabel}</span>
            <Badge variant="outline" className="text-[10px] text-gray-500">{entry.module}</Badge>
          </div>
          {entry.motif && (
            <p className="text-xs text-amber-700 mt-1 truncate">Motif : {entry.motif}</p>
          )}
        </div>

        {/* Utilisateur + actions */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-500">{entry.userName}</p>
            <p className="text-[10px] text-gray-400">{entry.changes.length} champ{entry.changes.length > 1 ? "s" : ""}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
          >
            <Eye className="w-4 h-4 text-gray-400" />
          </Button>
          {entry.changes.length > 0 && (
            expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>

      {/* Détails des changements (expandable) */}
      {expanded && entry.changes.length > 0 && (
        <div className="border-t bg-gray-50/50 p-3 space-y-2">
          {entry.changes.map((change, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="font-medium text-gray-600 min-w-[120px] text-xs">{change.field}</span>
              {change.oldValue && (
                <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs line-through border border-red-100">
                  {change.oldValue}
                </span>
              )}
              {change.oldValue && change.newValue && change.newValue !== "(supprimé)" && (
                <ArrowRight className="h-3 w-3 text-gray-400 shrink-0" />
              )}
              {change.newValue && (
                <span className={`px-2 py-0.5 rounded text-xs border ${
                  change.newValue === "(supprimé)" ? "bg-red-50 text-red-700 border-red-100" : "bg-green-50 text-green-700 border-green-100"
                }`}>
                  {change.newValue}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
