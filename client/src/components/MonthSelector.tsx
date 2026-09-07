import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { derniersMois, moisDepuis, moisLabel } from "@/lib/helpers";
import { CalendarDays } from "lucide-react";

// Sélecteur de mois réutilisé par Commerciaux, Livreurs et Producteurs pour
// consulter la performance d'un mois passé (pas seulement le mois en cours).
export function MonthSelector({
  value,
  onChange,
  monthsBack = 12,
  minMois,
}: {
  value: string;
  onChange: (mois: string) => void;
  monthsBack?: number;
  // Si fourni, la liste ne remonte pas plus loin que ce mois (format
  // "YYYY-MM") — évite de proposer des mois antérieurs au début réel de la
  // saisie, qui n'afficheraient que des zéros trompeurs.
  minMois?: string;
}) {
  const options = minMois ? moisDepuis(minMois) : derniersMois(monthsBack);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-48">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {options.map((m, i) => (
          <SelectItem key={m} value={m}>
            {moisLabel(m)}{i === 0 ? " (en cours)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
