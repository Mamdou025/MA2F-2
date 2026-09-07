/**
 * Système de clôture journalière — MA2F AquaSachet
 * 
 * Après clôture d'une journée, aucune modification n'est possible
 * sur les données de cette journée sans autorisation spéciale (admin + motif).
 * 
 * Les clôtures sont stockées dans DB.params.clotures (tableau de dates YYYY-MM-DD).
 */

import type { Database, ClotureInfo } from "./types";

/**
 * Vérifie si une date est clôturée
 */
export function isDateCloturee(date: string, DB: Database): boolean {
  const clotures = DB.params.clotures;
  if (!clotures || !Array.isArray(clotures)) return false;
  return clotures.some((c) => c.date === date);
}

// Reconstruit la liste plate des dates verrouillées à partir de clotures[]
// — c'est ce champ (params.clotureesDates) que firestore.rules teste
// désormais côté serveur (durci 2026-08-29, voir firestore.rules) pour
// refuser une écriture directe sur une journée clôturée, en plus du contrôle
// checkCloture()/canModifyEntry() ci-dessous qui reste purement côté UI.
// Même logique que computeClotureesDates() dans
// cloud-functions/src/index.ts — les deux DOIVENT rester synchronisées, ce
// chemin client n'étant utilisé qu'en secours quand les Cloud Functions sont
// indisponibles (voir cfCloturerCaisse/checkCloudFunctionsAvailability dans
// client/src/lib/cloudFunctions.ts).
function computeClotureesDates(clotures: ClotureInfo[]): string[] {
  const dates = new Set<string>();
  for (const c of clotures || []) {
    if (c && typeof c.date === "string" && c.verrouille !== false) dates.add(c.date);
  }
  return Array.from(dates);
}

/**
 * Vérifie si une opération peut être effectuée sur une date donnée.
 * Retourne un message d'erreur si la date est clôturée, null sinon.
 */
export function checkCloture(
  date: string,
  DB: Database,
  userRole: string
): string | null {
  if (!isDateCloturee(date, DB)) return null;

  if (userRole === "admin") {
    return null; // Admin peut modifier après clôture (avec motif obligatoire)
  }

  return `La journée du ${formatDateFR(date)} est clôturée. Aucune modification n'est possible sans autorisation de l'administrateur.`;
}

/**
 * Vérifie si l'utilisateur peut modifier une entrée datée
 * Retourne { allowed, requiresMotif, message }
 */
export function canModifyEntry(
  entryDate: string,
  DB: Database,
  userRole: string
): { allowed: boolean; requiresMotif: boolean; message: string | null } {
  if (!isDateCloturee(entryDate, DB)) {
    return { allowed: true, requiresMotif: false, message: null };
  }

  if (userRole === "admin") {
    return {
      allowed: true,
      requiresMotif: true,
      message: "Cette journée est clôturée. Un motif de modification est obligatoire.",
    };
  }

  return {
    allowed: false,
    requiresMotif: false,
    message: `La journée du ${formatDateFR(entryDate)} est clôturée. Contactez l'administrateur.`,
  };
}

/**
 * Récupère les informations d'une clôture
 */
export function getClotureInfo(date: string, DB: Database): ClotureInfo | null {
  const clotures = DB.params.clotures;
  if (!clotures || !Array.isArray(clotures)) return null;
  return clotures.find((c) => c.date === date) || null;
}

/**
 * Récupère toutes les clôtures triées par date décroissante
 */
export function getAllClotures(DB: Database): ClotureInfo[] {
  const clotures = DB.params.clotures;
  if (!clotures || !Array.isArray(clotures)) return [];
  return [...clotures].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Crée une clôture pour une date donnée
 */
export function createCloture(
  date: string,
  DB: Database,
  userName: string
): { newDB: Database; cloture: ClotureInfo } {
  // Calculer les totaux du jour
  const ventesJour = DB.ventes.filter((v) => v.date === date);
  const depensesJour = DB.depenses.filter((d) => d.date === date);
  const productionJour = DB.production.filter((p) => p.date === date);
  const recouvrementsJour = DB.recouvrements.filter((r) => r.date === date);
  const versementsJour = DB.versements.filter((v) => v.date === date);
  const apportsJour = ((DB as any).apports || []).filter((a: any) => a.date === date);
  const maintenanceJour = DB.maintenance.filter((m) => m.date === date);
  const vehiculeOpsJour = DB.vehiculeOps.filter((op) => op.date === date);

  // Entrées du jour
  const entreesVentes = ventesJour
    .filter((v) => v.mode === "Payé")
    .reduce((s, v) => s + v.packs * v.prix, 0);
  const entreesAvances = ventesJour
    .filter((v) => v.mode === "Crédit" && v.avance)
    .reduce((s, v) => s + (v.avance || 0), 0);
  const entreesRecouvrements = recouvrementsJour.reduce((s, r) => s + r.montant, 0);
  const entreesApports = apportsJour.reduce((s: number, a: any) => s + a.montant, 0);
  const totalEntrees = entreesVentes + entreesAvances + entreesRecouvrements + entreesApports;

  // Sorties du jour
  const sortiesDepenses = depensesJour.reduce((s, d) => s + d.montant, 0);
  const sortiesVersements = versementsJour.reduce((s, v) => s + v.montant, 0);
  const sortiesMaintenance = maintenanceJour.reduce((s, m) => s + m.cout, 0);
  const sortiesVehicules = vehiculeOpsJour.reduce((s, op) => s + op.montant, 0);
  const totalSorties = sortiesDepenses + sortiesVersements + sortiesMaintenance + sortiesVehicules;

  const cloture: ClotureInfo = {
    date,
    clotureePar: userName,
    clotureeLe: new Date().toISOString(),
    soldeJour: totalEntrees - totalSorties,
    totalEntrees,
    totalSorties,
    totalVentes: ventesJour.length,
    totalProduction: productionJour.reduce((s, p) => s + p.packs, 0),
  };

  const existingClotures = DB.params.clotures || [];
  const newClotures = [...existingClotures.filter((c) => c.date !== date), cloture];

  const newDB: Database = {
    ...DB,
    params: {
      ...DB.params,
      clotures: newClotures,
      clotureesDates: computeClotureesDates(newClotures),
    },
  };

  return { newDB, cloture };
}

/**
 * Annule une clôture (admin uniquement)
 */
export function annulerCloture(date: string, DB: Database): Database {
  const existingClotures = DB.params.clotures || [];
  const newClotures = existingClotures.filter((c) => c.date !== date);

  return {
    ...DB,
    params: {
      ...DB.params,
      clotures: newClotures,
      clotureesDates: computeClotureesDates(newClotures),
    },
  };
}

// Utilitaire
function formatDateFR(date: string): string {
  try {
    return new Date(date).toLocaleDateString("fr-FR");
  } catch {
    return date;
  }
}
