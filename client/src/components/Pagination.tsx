import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  hasNext,
  hasPrev,
  nextPage,
  prevPage,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <p className="text-sm text-gray-500">
        {startIndex}–{endIndex} sur {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={prevPage}
          disabled={!hasPrev}
          aria-label="Page précédente"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm text-gray-600 min-w-[80px] text-center">
          Page {currentPage} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={nextPage}
          disabled={!hasNext}
          aria-label="Page suivante"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
