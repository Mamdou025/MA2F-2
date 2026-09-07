import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, Filter, CalendarDays, Clock } from "lucide-react";
import { toLocalDateStr, todayLocal } from "@/lib/helpers";

export interface FilterConfig {
  /** Activer le filtre par plage de dates */
  dateRange?: boolean;
  /** Activer la recherche textuelle */
  search?: boolean;
  /** Placeholder pour la recherche */
  searchPlaceholder?: string;
  /** Options de catégorie pour le filtre Select */
  categories?: { value: string; label: string }[];
  /** Label du filtre catégorie */
  categoryLabel?: string;
}

export interface FilterValues {
  dateFrom: string;
  dateTo: string;
  search: string;
  category: string;
}

interface TableFiltersProps {
  config: FilterConfig;
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  resultCount?: number;
  totalCount?: number;
}

export const defaultFilterValues: FilterValues = {
  dateFrom: "",
  dateTo: "",
  search: "",
  category: "",
};

// Helpers pour les raccourcis temporels
function getToday(): string {
  return todayLocal();
}

function getStartOfWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=dimanche, 1=lundi...
  const diff = day === 0 ? 6 : day - 1; // Lundi = début de semaine
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return toLocalDateStr(monday);
}

function getStartOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

type QuickFilter = "today" | "week" | "month" | null;

export default function TableFilters({ config, values, onChange, resultCount, totalCount }: TableFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeQuickFilter, setActiveQuickFilter] = useState<QuickFilter>(null);

  const hasActiveFilters = values.dateFrom || values.dateTo || values.search || values.category;

  const handleReset = () => {
    onChange(defaultFilterValues);
    setActiveQuickFilter(null);
  };

  const updateFilter = (key: keyof FilterValues, value: string) => {
    onChange({ ...values, [key]: value });
    // Si l'utilisateur modifie manuellement les dates, désactiver le raccourci actif
    if (key === "dateFrom" || key === "dateTo") {
      setActiveQuickFilter(null);
    }
  };

  const applyQuickFilter = (type: QuickFilter) => {
    if (activeQuickFilter === type) {
      // Désactiver le raccourci
      onChange({ ...values, dateFrom: "", dateTo: "" });
      setActiveQuickFilter(null);
      return;
    }

    const today = getToday();
    let dateFrom = "";
    let dateTo = today;

    switch (type) {
      case "today":
        dateFrom = today;
        dateTo = today;
        break;
      case "week":
        dateFrom = getStartOfWeek();
        dateTo = today;
        break;
      case "month":
        dateFrom = getStartOfMonth();
        dateTo = today;
        break;
    }

    onChange({ ...values, dateFrom, dateTo });
    setActiveQuickFilter(type);
  };

  return (
    <div className="space-y-3">
      {/* Barre principale : recherche + bouton filtre */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        {config.search && (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={values.search}
              onChange={(e) => updateFilter("search", e.target.value)}
              placeholder={config.searchPlaceholder || "Rechercher..."}
              className="pl-9 pr-8 h-9 bg-white"
            />
            {values.search && (
              <button
                onClick={() => updateFilter("search", "")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Effacer la recherche"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className={`gap-2 h-9 ${hasActiveFilters ? "border-[#1B4B6B] text-[#1B4B6B] bg-blue-50" : ""}`}
          >
            <Filter className="w-4 h-4" />
            Filtres
            {hasActiveFilters && (
              <span className="w-5 h-5 rounded-full bg-[#1B4B6B] text-white text-xs flex items-center justify-center">
                {[values.dateFrom, values.dateTo, values.category].filter(Boolean).length + (values.search ? 0 : 0)}
              </span>
            )}
          </Button>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 h-9 text-gray-500 hover:text-red-600">
              <X className="w-3 h-3" /> Réinitialiser
            </Button>
          )}
        </div>
      </div>

      {/* Raccourcis temporels */}
      {config.dateRange && (
        <div className="flex flex-wrap items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-500 font-medium mr-1">Période :</span>
          <Button
            variant={activeQuickFilter === "today" ? "default" : "outline"}
            size="sm"
            onClick={() => applyQuickFilter("today")}
            className={`h-7 text-xs px-3 ${
              activeQuickFilter === "today"
                ? "bg-[#1B4B6B] hover:bg-[#0d4a85] text-white"
                : "hover:border-[#1B4B6B] hover:text-[#1B4B6B]"
            }`}
          >
            Aujourd'hui
          </Button>
          <Button
            variant={activeQuickFilter === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => applyQuickFilter("week")}
            className={`h-7 text-xs px-3 ${
              activeQuickFilter === "week"
                ? "bg-[#1B4B6B] hover:bg-[#0d4a85] text-white"
                : "hover:border-[#1B4B6B] hover:text-[#1B4B6B]"
            }`}
          >
            Cette semaine
          </Button>
          <Button
            variant={activeQuickFilter === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => applyQuickFilter("month")}
            className={`h-7 text-xs px-3 ${
              activeQuickFilter === "month"
                ? "bg-[#1B4B6B] hover:bg-[#0d4a85] text-white"
                : "hover:border-[#1B4B6B] hover:text-[#1B4B6B]"
            }`}
          >
            Ce mois
          </Button>
        </div>
      )}

      {/* Panneau de filtres avancés */}
      {expanded && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3 animate-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col sm:flex-row gap-3">
            {config.dateRange && (
              <>
                <div className="flex-1 min-w-[140px]">
                  <label className="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" /> Date début
                  </label>
                  <Input
                    type="date"
                    value={values.dateFrom}
                    onChange={(e) => updateFilter("dateFrom", e.target.value)}
                    className="h-9 bg-white"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" /> Date fin
                  </label>
                  <Input
                    type="date"
                    value={values.dateTo}
                    onChange={(e) => updateFilter("dateTo", e.target.value)}
                    className="h-9 bg-white"
                  />
                </div>
              </>
            )}

            {config.categories && config.categories.length > 0 && (
              <div className="flex-1 min-w-[160px]">
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  {config.categoryLabel || "Catégorie"}
                </label>
                <Select value={values.category || "all"} onValueChange={(v) => updateFilter("category", v === "all" ? "" : v)}>
                  <SelectTrigger className="h-9 bg-white">
                    <SelectValue placeholder="Toutes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    {config.categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Indicateur de résultats */}
      {hasActiveFilters && resultCount !== undefined && totalCount !== undefined && (
        <p className="text-xs text-gray-500">
          {resultCount} résultat{resultCount > 1 ? "s" : ""} sur {totalCount} enregistrement{totalCount > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
