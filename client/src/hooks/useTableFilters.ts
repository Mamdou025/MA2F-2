import { useState, useMemo } from "react";
import { FilterValues, defaultFilterValues } from "@/components/TableFilters";

interface UseTableFiltersOptions<T> {
  data: T[];
  /** Fonction pour extraire la date (string YYYY-MM-DD) d'un élément */
  getDate?: (item: T) => string;
  /** Fonction pour extraire la catégorie d'un élément */
  getCategory?: (item: T) => string;
  /** Fonction pour extraire le texte de recherche d'un élément */
  getSearchText?: (item: T) => string;
}

export function useTableFilters<T>({ data, getDate, getCategory, getSearchText }: UseTableFiltersOptions<T>) {
  const [filters, setFilters] = useState<FilterValues>(defaultFilterValues);

  const filteredData = useMemo(() => {
    let result = [...data];

    // Filtre par date début
    if (filters.dateFrom && getDate) {
      result = result.filter((item) => getDate(item) >= filters.dateFrom);
    }

    // Filtre par date fin
    if (filters.dateTo && getDate) {
      result = result.filter((item) => getDate(item) <= filters.dateTo);
    }

    // Filtre par catégorie
    if (filters.category && getCategory) {
      result = result.filter((item) => getCategory(item) === filters.category);
    }

    // Filtre par recherche textuelle
    if (filters.search && getSearchText) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((item) => getSearchText(item).toLowerCase().includes(searchLower));
    }

    return result;
  }, [data, filters, getDate, getCategory, getSearchText]);

  return {
    filters,
    setFilters,
    filteredData,
    totalCount: data.length,
    resultCount: filteredData.length,
  };
}
