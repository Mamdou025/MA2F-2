/**
 * Système d'historique des modifications — MA2F AquaSachet
 * 
 * Enregistre pour chaque modification :
 * - Ancienne valeur
 * - Nouvelle valeur
 * - Utilisateur
 * - Date et heure
 * - Motif de modification (obligatoire pour les jours clôturés)
 */

import type { Database, HistoryEntry } from "./types";
import { uid } from "./helpers";

// Conservation illimitée pour conformité audit (SYSCOHADA)
// const MAX_HISTORY = 2000; // SUPPRIMÉ — Aucune troncature autorisée

/**
 * Compare deux objets et retourne la liste des changements
 */
export function diffObjects(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  fieldLabels?: Record<string, string>
): { field: string; oldValue: string; newValue: string }[] {
  const changes: { field: string; oldValue: string; newValue: string }[] = [];
  const allKeys = Array.from(new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]));

  for (const key of allKeys) {
    // Ignorer les champs techniques
    if (key === "id" || key === "numero") continue;

    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    // Comparer les valeurs (conversion en string pour comparaison)
    const oldStr = formatValue(oldVal);
    const newStr = formatValue(newVal);

    if (oldStr !== newStr) {
      changes.push({
        field: fieldLabels?.[key] || key,
        oldValue: oldStr,
        newValue: newStr,
      });
    }
  }

  return changes;
}

/**
 * Crée une entrée d'historique pour une création
 */
export function createHistoryEntry(
  module: string,
  entityId: string,
  entityLabel: string,
  newData: Record<string, any>,
  userName: string,
  motif?: string,
  fieldLabels?: Record<string, string>
): HistoryEntry {
  const changes = Object.entries(newData)
    .filter(([key]) => key !== "id" && key !== "numero")
    .map(([key, val]) => ({
      field: fieldLabels?.[key] || key,
      oldValue: "",
      newValue: formatValue(val),
    }));

  return {
    id: uid(),
    timestamp: new Date().toISOString(),
    module,
    action: "create",
    entityId,
    entityLabel,
    userName,
    motif,
    changes,
  };
}

/**
 * Crée une entrée d'historique pour une modification
 */
export function updateHistoryEntry(
  module: string,
  entityId: string,
  entityLabel: string,
  oldData: Record<string, any>,
  newData: Record<string, any>,
  userName: string,
  motif?: string,
  fieldLabels?: Record<string, string>
): HistoryEntry | null {
  const changes = diffObjects(oldData, newData, fieldLabels);
  if (changes.length === 0) return null;

  return {
    id: uid(),
    timestamp: new Date().toISOString(),
    module,
    action: "update",
    entityId,
    entityLabel,
    userName,
    motif,
    changes,
  };
}

/**
 * Crée une entrée d'historique pour une suppression
 */
export function deleteHistoryEntry(
  module: string,
  entityId: string,
  entityLabel: string,
  oldData: Record<string, any>,
  userName: string,
  motif?: string,
  fieldLabels?: Record<string, string>
): HistoryEntry {
  const changes = Object.entries(oldData)
    .filter(([key]) => key !== "id" && key !== "numero")
    .map(([key, val]) => ({
      field: fieldLabels?.[key] || key,
      oldValue: formatValue(val),
      newValue: "(supprimé)",
    }));

  return {
    id: uid(),
    timestamp: new Date().toISOString(),
    module,
    action: "delete",
    entityId,
    entityLabel,
    userName,
    motif,
    changes,
  };
}

/**
 * Ajoute une entrée d'historique à la base
 */
export function addHistoryEntry(DB: Database, entry: HistoryEntry): Database {
  const newHistory = [entry, ...(DB.history || [])];
  return { ...DB, history: newHistory };
}

/**
 * Récupère l'historique d'une entité spécifique
 */
export function getEntityHistory(DB: Database, entityId: string): HistoryEntry[] {
  return (DB.history || []).filter((h) => h.entityId === entityId);
}

/**
 * Récupère l'historique d'un module
 */
export function getModuleHistory(DB: Database, module: string): HistoryEntry[] {
  return (DB.history || []).filter((h) => h.module === module);
}

// Utilitaire de formatage
function formatValue(val: any): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "Oui" : "Non";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

// Labels français pour les champs courants
export const FIELD_LABELS: Record<string, string> = {
  date: "Date",
  packs: "Packs",
  prix: "Prix",
  client: "Client",
  commercial: "Commercial",
  livreur: "Livreur",
  mode: "Mode paiement",
  avance: "Avance",
  modePaiement: "Mode paiement",
  bonus: "Bonus",
  nom: "Nom",
  tel: "Téléphone",
  zone: "Zone",
  type: "Type",
  categorie: "Catégorie",
  libelle: "Libellé",
  fournisseur: "Fournisseur",
  montant: "Montant",
  kg: "Kilogrammes",
  kgCommande: "Quantité commandée (kg)",
  prixKgCommande: "Prix convenu (F/kg)",
  qualiteConforme: "Qualité conforme",
  quantiteRejetee: "Quantité rejetée (kg)",
  qualiteNotes: "Notes qualité",
  heureAppel: "Heure de saisie",
  adresseDetail: "Précision d'adresse",
  livreurId: "Livreur assigné",
  dateLivraisonPrevue: "Date de livraison prévue",
  heureLivraisonPrevue: "Heure de livraison prévue",
  statut: "Statut",
  livreeLe: "Livrée le (horodatage)",
  enLivraisonLe: "Départ en livraison (horodatage)",
  livraisonIds: "Livraisons consommées",
  rebuts: "Rebuts (sachets)",
  rebutsNotes: "Notes rebuts",
  machine: "Machine / ligne",
  arret: "Arrêt machine",
  dureeArretHeures: "Durée d'arrêt (h)",
  packsPerdusEstimes: "Packs perdus estimés",
  equipement: "Équipement",
  description: "Description",
  cout: "Coût",
  prochaine: "Prochaine maintenance",
  beneficiaire: "Bénéficiaire",
  source: "Source",
  reference: "Référence",
  notes: "Notes",
  chauffeur: "Chauffeur",
  km: "Kilométrage",
  litres: "Litres",
  objectif: "Objectif",
  actif: "Actif",
  poste: "Poste",
  salaireBase: "Salaire de base",
  employeId: "Employé",
  pourcentageParts: "Pourcentage de parts",
  actionnaireId: "Actionnaire",
  roles: "Rôles",
  role: "Rôle",
  email: "Email",
  produit: "Produit",
  emplacement: "Emplacement",
  stockTheorique: "Stock théorique",
  stockCompte: "Stock compté",
  ecart: "Écart",
  comptePar: "Compté par",
  compteLe: "Compté le",
  explicationEcart: "Explication de l'écart",
};
