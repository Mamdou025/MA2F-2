import { useMemo, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/usePagination";
import { Pagination } from "@/components/Pagination";
import TableFilters from "@/components/TableFilters";
import { useTableFilters } from "@/hooks/useTableFilters";
import type { JournalEntry } from "@/lib/types";

export default function JournalSection() {
  const { DB } = useApp();

  // Données triées (plus récent en premier)
  // new Date(x.timestamp || 0) : une entrée sans timestamp ne fait pas
  // planter le tri (contrairement à .localeCompare sur undefined), mais sans
  // ce filet elle produirait un NaN qui rend l'ordre du tableau instable —
  // avec le repli, elle est simplement traitée comme la plus ancienne.
  const sortedJournal = useMemo(() =>
    [...DB.journal].sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()),
    [DB.journal]
  );

  // Catégories : modules distincts
  const moduleCategories = useMemo(() => {
    const modules = Array.from(new Set(DB.journal.map((j) => j.module).filter(Boolean)));
    return modules.map((m) => ({ value: m, label: m }));
  }, [DB.journal]);

  // Filtres avancés
  const getDate = useCallback((j: JournalEntry) => j.timestamp.split("T")[0], []);
  const getCategory = useCallback((j: JournalEntry) => j.module, []);
  const getSearchText = useCallback((j: JournalEntry) => `${j.type} ${j.module} ${j.details} ${j.userName}`, []);

  const { filters, setFilters, filteredData, totalCount, resultCount } = useTableFilters({
    data: sortedJournal,
    getDate,
    getCategory,
    getSearchText,
  });

  const pagination = usePagination(filteredData, { pageSize: 30 });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Journal d'activité</h2>
        <p className="text-sm text-gray-500">{DB.journal.length} entrée(s)</p>
      </div>

      {/* Filtres avancés */}
      <TableFilters
        config={{
          dateRange: true,
          search: true,
          searchPlaceholder: "Rechercher par type, module, détails, utilisateur...",
          categories: moduleCategories,
          categoryLabel: "Module",
        }}
        values={filters}
        onChange={setFilters}
        resultCount={resultCount}
        totalCount={totalCount}
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Heure</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Détails</TableHead>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Appareil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.paginatedItems.length > 0 ? pagination.paginatedItems.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(j.timestamp).toLocaleString("fr-FR")}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        j.type === "create" ? "bg-green-100 text-green-800" :
                        j.type === "delete" ? "bg-red-100 text-red-800" :
                        j.type === "update" ? "bg-blue-100 text-blue-800" :
                        "bg-gray-100"
                      }`}>{j.type}</span>
                    </TableCell>
                    <TableCell>{j.module}</TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{j.details}</TableCell>
                    <TableCell className="text-sm">{j.userName}</TableCell>
                    <TableCell className="text-xs">{j.device}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                      {filters.search || filters.dateFrom || filters.dateTo || filters.category ? "Aucun résultat avec ces filtres" : "Aucune activité enregistrée"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...pagination} />
        </CardContent>
      </Card>
    </div>
  );
}
