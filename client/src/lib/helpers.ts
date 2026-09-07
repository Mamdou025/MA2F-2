import type { Database, Vente, PalierPrime, Production, Commande } from "./types";
import type { MouvementStock } from "./stock";
import { calculerStockParEmplacement } from "./stock";
import { nanoid } from "nanoid";

export function uid(): string {
  return nanoid(10);
}

/**
 * Retard (en minutes) entre l'heure de livraison PRÉVUE (Commande.dateLivraisonPrevue
 * + heureLivraisonPrevue) et l'heure de livraison RÉELLE (Commande.livreeLe, capturé
 * automatiquement au passage du statut à "livree" — voir CommandesSection.tsx). Positif
 * = livrée en retard, négatif = livrée en avance, 0 = pile à l'heure.
 *
 * Retourne null quand la comparaison n'a pas de sens : commande pas encore livrée
 * (livreeLe absent), pas d'heure prévue renseignée (dateLivraisonPrevue/heureLivraisonPrevue
 * absentes — rien à comparer), ou une commande livrée avant l'ajout de ce suivi
 * (2026-08-13, livreeLe absent sur les commandes déjà livrées à cette date). Ce null
 * doit être traité comme "pas de donnée", pas comme "à l'heure" par l'appelant.
 */
export function calculerRetardLivraisonMinutes(c: Commande): number | null {
  if (!c.livreeLe || !c.heureLivraisonPrevue) return null;
  const datePrevue = c.dateLivraisonPrevue || c.date;
  const prevueMs = new Date(`${datePrevue}T${c.heureLivraisonPrevue}:00`).getTime();
  const reelleMs = new Date(c.livreeLe).getTime();
  if (Number.isNaN(prevueMs) || Number.isNaN(reelleMs)) return null;
  return Math.round((reelleMs - prevueMs) / 60000);
}

/**
 * Normalise un texte pour une recherche tolérante : minuscules, accents
 * retirés (Ndèye → ndeye, Moûssa → moussa), espaces superflus réduits.
 * Utilisé partout où on cherche un client/nom par saisie libre, pour éviter
 * qu'une variation d'accent ou de casse fasse "disparaître" un résultat
 * pourtant présent (voir ClientsSection.tsx).
 */
const DIACRITICS_START = String.fromCharCode(0x0300);
const DIACRITICS_END = String.fromCharCode(0x036f);
const DIACRITICS_REGEX = new RegExp("[" + DIACRITICS_START + "-" + DIACRITICS_END + "]", "g");

export function normaliserTexte(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function fmt(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " F";
}

export function fmtDate(d: string): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("fr-FR");
  } catch {
    return d;
  }
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function cashAtSale(v: Vente, DB: Database): number {
  const montant = v.packs * v.prix;
  const recouvTotal = DB.recouvrements
    .filter((r) => r.venteId === v.id)
    .reduce((s, r) => s + r.montant, 0);
  if (v.avance !== undefined && v.avance !== null)
    return Math.min(v.avance, montant);
  return v.mode === "Payé" ? Math.max(0, montant - recouvTotal) : 0;
}

export function resteVente(v: Vente, DB: Database): number {
  const montant = v.packs * v.prix;
  const recouvTotal = DB.recouvrements
    .filter((r) => r.venteId === v.id)
    .reduce((s, r) => s + r.montant, 0);
  return montant - cashAtSale(v, DB) - recouvTotal;
}

export function bonusVente(v: Vente, DB: Database): number {
  if (v && v.bonus != null) return v.bonus;
  return calculerBonusVente(Number(v?.packs) || 0, v?.client || "", DB);
}

/**
 * Calcule le bonus (en packs) à accorder pour un achat, en tenant compte
 * d'une éventuelle règle exceptionnelle propre au client (Client.bonusExceptionnel,
 * voir types.ts) qui remplace le seuil global DB.params.bonusSeuil. Par
 * défaut (pas de règle client) : 1 pack offert par tranche de bonusSeuil
 * packs achetés — comportement inchangé.
 */
export function calculerBonusVente(packs: number, clientNom: string, DB: Database): number {
  const client = DB.clients.find((c) => c.nom === clientNom);
  const regle = client?.bonusExceptionnel;
  if (regle && regle.seuil > 0) {
    return Math.floor(packs / regle.seuil) * (regle.packsBonus || 0);
  }
  let seuil = Number(DB.params.bonusSeuil);
  if (!seuil || seuil < 1) seuil = 10;
  return Math.floor(packs / seuil);
}

// ============================================================
// Grandeurs "balance" — cumulatives, indépendantes de toute période.
//
// Contrairement à un flux ("ventes du mois", "dépenses de la semaine", qui
// se remet à zéro à chaque période), une balance représente un état à
// l'instant présent (solde de caisse, stock en entrepôt, créances dues) et
// doit toujours être calculée sur la TOTALITÉ de l'historique. En
// particulier, DB.params.soldeOuverture ne doit jamais être injecté dans un
// total filtré par période — c'est exactement le bug qui a faussé le solde
// de caisse affiché début août 2026 (voir CLAUDE.md, section "Balance vs
// flux").
//
// Ces deux fonctions sont l'implémentation canonique, utilisée par
// CaisseSection, Dashboard et tests-calculs — pour éviter que ces écrans ne
// réimplémentent chacun leur propre variante et ne divergent avec le temps.
// ============================================================

// Solde de caisse à une date donnée (incluse), ou solde actuel si aucune
// date n'est fournie. C'est l'implémentation unique derrière à la fois
// computeSoldeCaisseActuel (sans cutoff = tout l'historique jusqu'à
// aujourd'hui) et le solde "photo" en fin de période choisie dans
// CaisseSection (ex: "mois précédent" → solde tel qu'il était le dernier
// jour de ce mois-là). Le solde d'ouverture est toujours inclus en entier
// dès lors qu'on demande un solde à une date quelconque, puisqu'il précède
// toute transaction — jamais filtré par date lui-même.
export function computeSoldeCaisseAuDate(DB: Database, dateFinISO?: string): number {
  const enDate = (d: string | undefined) => !dateFinISO || (!!d && d <= dateFinISO);

  const apports = ((DB as any).apports || []) as { date?: string; montant: number }[];

  const totalEntrees =
    DB.ventes.filter((v) => enDate(v.date)).reduce((s, v) => s + cashAtSale(v, DB), 0) +
    DB.recouvrements.filter((r) => enDate(r.date)).reduce((s, r) => s + r.montant, 0) +
    apports.filter((a) => enDate(a.date)).reduce((s, a) => s + a.montant, 0) +
    (DB.params.soldeOuverture || 0);

  const depensesFiltrees = DB.depenses.filter((d) => enDate(d.date));
  const totalDepenses = depensesFiltrees.reduce((s, d) => s + d.montant, 0);

  // Opérations véhicules / maintenance non déjà comptées comme dépenses
  // (évite le double comptage quand une opération a aussi été saisie
  // manuellement dans Dépenses). Le doublon est recherché uniquement parmi
  // les dépenses déjà filtrées à la même date-limite, pour rester cohérent.
  const vehiculeOpsNonComptees = DB.vehiculeOps.filter((op) => {
    if (!enDate(op.date)) return false;
    const categorie = op.type === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule";
    return !depensesFiltrees.some((d) => d.date === op.date && d.montant === op.montant && d.categorie === categorie);
  });
  const maintenanceNonComptee = DB.maintenance.filter(
    (m) => enDate(m.date) && m.cout > 0 && !depensesFiltrees.some((d) => d.date === m.date && d.montant === m.cout && d.categorie === "Maintenance machine")
  );
  const totalVersements = DB.versements.filter((v) => enDate(v.date)).reduce((s, v) => s + v.montant, 0);

  const totalSorties =
    totalDepenses +
    vehiculeOpsNonComptees.reduce((s, op) => s + op.montant, 0) +
    maintenanceNonComptee.reduce((s, m) => s + m.cout, 0) +
    totalVersements;

  return totalEntrees - totalSorties;
}

export function computeSoldeCaisseActuel(DB: Database): number {
  return computeSoldeCaisseAuDate(DB);
}

// Calcul canonique du stock de produit fini (packs), tous emplacements
// confondus (usine + camions + dépôt). Avant le 2026-08-03, cette fonction
// recalculait indépendamment "production totale − ventes totales − bonus"
// depuis DB.production/DB.ventes, un chemin de calcul complètement séparé du
// journal DB.mouvementsStock utilisé par Gestion du Stock (StockSection.tsx,
// calculerStockParEmplacement). Résultat : le Dashboard et Gestion du Stock
// affichaient deux chiffres de "stock restant" différents qui ne
// concordaient jamais (le Dashboard ignorait les casses/pertes, les
// ajustements d'inventaire, et un éventuel "Nouveau départ" posé dans
// Gestion du Stock). Elle rejoue maintenant le même journal, donc les deux
// écrans affichent toujours exactement le même total.
export function computeStockRestant(DB: Database): number {
  const mouvements = (DB.mouvementsStock || []) as MouvementStock[];
  return calculerStockParEmplacement(mouvements)
    .filter((s) => s.produit === "sachet_plein")
    .reduce((total, s) => total + s.quantite, 0);
}

// Stock de matière première (kg de rouleau plastique) = kg livrés - kg
// consommés en production, calculé via le rendement packs/kg des Paramètres.
// Même balance cumulative que les deux fonctions ci-dessus (voir "Balance
// vs flux" dans CLAUDE.md) — utilisé par tests-calculs.ts et l'export Excel.
export function computeStockMatierePremiere(DB: Database): number {
  const totalKgLivres = DB.livraisons.reduce((s, l) => s + (l.kg || 0), 0);
  const taux = DB.params.tauxSachetsParKg || 17;
  const totalPacksProduits = DB.production.reduce((s, p) => s + (p.packs || 0), 0);
  const kgConsommes = totalPacksProduits / taux;
  return totalKgLivres - kgConsommes;
}

// Packs produits par UN producteur donné, sur les lots passés au filtre
// datePredicate (ou tous si omis). Additionne deux sources : les lots à un
// seul producteur (Production.producteurId, saisie rapide dans
// ProducteursSection) ET la part de ce producteur dans un lot partagé par
// plusieurs producteurs (Production.producteurs[], saisi depuis "+ Nouveau
// lot" dans ProductionSection). Sans ce deuxième cas, la production d'un
// producteur qui ne travaille que sur des lots machine partagés serait
// invisible dans son suivi individuel (production du jour, objectif du
// mois) alors qu'elle compte bien dans le total usine.
export function packsProducteurPeriode(
  production: Production[],
  producteurId: string,
  datePredicate?: (date: string) => boolean
): number {
  let total = 0;
  for (const pr of production) {
    if (datePredicate && !datePredicate(pr.date)) continue;
    if (pr.producteurId === producteurId) total += pr.packs;
    const part = pr.producteurs?.find((r) => r.producteurId === producteurId);
    if (part) total += part.packs;
  }
  return total;
}

// Seuil (kg) en dessous duquel le stock de rouleau plastique est considéré
// critique — partagé par LivraisonsSection.tsx (bannière + toast à la
// réception) et Dashboard.tsx (signal danger cliquable) pour qu'un seul
// endroit contrôle ce chiffre.
export const SEUIL_ALERTE_STOCK_ROULEAU_KG = 100;

// Taux de commission (F/pack) applicable à cette vente : celui figé sur la
// vente elle-même (tauxCommission) si présent, sinon le taux courant des
// Paramètres — c'est ce fallback qui garde les ventes créées avant l'ajout
// de ce champ affichées avec le même montant qu'avant (pas de rupture visible
// dans l'historique), tandis que toute nouvelle vente reste figée pour de bon.
export function tauxCommissionVente(v: Vente, DB: Database): number {
  if (v && v.tauxCommission != null) return v.tauxCommission;
  const taux = Number(DB.params.taux);
  return !taux || taux < 0 ? 50 : taux;
}

// Montant de commission (F) généré par cette vente, indépendamment du filtre
// "mode Payé + commercial renseigné" que les appelants appliquent déjà
// (CommerciauxSection, exportComptable) — cette fonction ne fait que le calcul.
export function commissionVente(v: Vente, DB: Database): number {
  return (Number(v?.packs) || 0) * tauxCommissionVente(v, DB);
}

// Convertit un Date en "YYYY-MM-DD" à partir de ses composants LOCAUX
// (getFullYear/getMonth/getDate), PAS via toISOString() (qui convertit
// d'abord en UTC). Dans un fuseau horaire en avance sur UTC (ex: UTC+1 pour
// Douala/Yaoundé), toISOString().split("T")[0] renvoie encore la veille
// pendant les toutes premières heures de chaque journée locale — une vente
// saisie le 1er août à 00h30 locale se voyait ainsi datée "2026-07-31" par
// défaut, sans que personne ne s'en aperçoive. Utilisé partout où l'app
// calcule "la date d'aujourd'hui" ou convertit un Date en chaîne de date.
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayLocal(): string {
  return toLocalDateStr(new Date());
}

// Ajoute `years` années à une date "YYYY-MM-DD" en construisant le Date via
// ses composants (new Date(y, m, d)) plutôt qu'en parsant la chaîne — évite
// tout décalage de fuseau horaire, même si l'app est un jour ouverte depuis
// un fuseau différent de Dakar (UTC+0). Retourne "" si la date est vide/invalide.
export function addYears(dateStr: string, years: number): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  dt.setFullYear(dt.getFullYear() + years);
  return toLocalDateStr(dt);
}

// Nombre de jours entre deux dates "YYYY-MM-DD" (b - a). Positif si b est
// après a. Utilisé pour les échéances (ex: alerte "à J-10").
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, (am || 1) - 1, ad || 1);
  const db = new Date(by, (bm || 1) - 1, bd || 1);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export function getMoisCourant(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

const MOIS_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// "2026-08" -> "Août 2026" — utilisé par le sélecteur de mois des rubriques
// Commerciaux / Livreurs / Producteurs.
export function moisLabel(moisKey: string): string {
  const [y, m] = (moisKey || "").split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return moisKey || "-";
  return `${MOIS_LABELS[m - 1]} ${y}`;
}

// --- Objectifs & primes (ObjectifsSection.tsx) -----------------------------
// Grille de primes par défaut, alignée sur le "Plan de motivation — Livreurs
// & Commerciaux" (août 2026). N'est utilisée que tant qu'un admin n'a pas
// personnalisé DB.params.primesPaliers dans ObjectifsSection.tsx — dès qu'il
// enregistre une grille, celle-ci est persistée et remplace ces valeurs par
// défaut à l'affichage comme au calcul.
export const DEFAULT_PALIERS_COMMERCIAL: PalierPrime[] = [
  { label: "Palier 1", seuilPct: 80, montant: 50000 },
  { label: "Palier 2", seuilPct: 100, montant: 150000 },
  { label: "Palier 3", seuilPct: 120, montant: 300000 },
];

export const DEFAULT_PALIERS_LIVREUR: PalierPrime[] = [
  { label: "Palier 1", seuilPct: 80, montant: 30000 },
  { label: "Palier 2", seuilPct: 100, montant: 80000 },
  { label: "Palier 3", seuilPct: 120, montant: 150000 },
];

export function getPaliersCommercial(DB: Database): PalierPrime[] {
  return DB.params.primesPaliers?.commercial?.length ? DB.params.primesPaliers.commercial : DEFAULT_PALIERS_COMMERCIAL;
}

export function getPaliersLivreur(DB: Database): PalierPrime[] {
  return DB.params.primesPaliers?.livreur?.length ? DB.params.primesPaliers.livreur : DEFAULT_PALIERS_LIVREUR;
}

// Packs vendus par un commercial sur un mois donné ("YYYY-MM"), toutes ventes
// confondues (payées ou à crédit) — c'est ce volume, pas la commission, qui
// sert de base à "% de l'objectif atteint" (même logique que CommerciauxSection).
export function packsVenteMois(DB: Database, commercialNom: string, mois: string): number {
  return DB.ventes.filter((v) => v.commercial === commercialNom && (v.date || "").startsWith(mois)).reduce((s, v) => s + (v.packs || 0), 0);
}

// Packs livrés par un livreur sur un mois donné ("YYYY-MM") — même logique que
// LivreursSection (DB.ventes.livreur, pas d'unité temps/qualité trackée à ce
// jour ; voir note dans ObjectifsSection.tsx sur les limites de ponctualité/casse).
export function packsLivreurMois(DB: Database, livreurNom: string, mois: string): number {
  return DB.ventes.filter((v) => v.livreur === livreurNom && (v.date || "").startsWith(mois)).reduce((s, v) => s + (v.packs || 0), 0);
}

// Palier le plus haut atteint pour un % d'objectif donné, ou null si aucun
// palier n'est atteint (paliers évalués du plus haut seuilPct au plus bas ;
// un seul palier est retenu — les primes ne se cumulent pas entre paliers).
export function palierAtteint(pct: number, paliers: PalierPrime[]): PalierPrime | null {
  const tries = [...paliers].sort((a, b) => b.seuilPct - a.seuilPct);
  return tries.find((p) => pct >= p.seuilPct) || null;
}

// Montant de prime correspondant au palier le plus haut atteint pour ce %
// d'objectif (0 si aucun palier atteint).
export function primeMontant(pct: number, paliers: PalierPrime[]): number {
  return palierAtteint(pct, paliers)?.montant || 0;
}

// Liste des `n` derniers mois (le mois en cours en premier), au format
// "YYYY-MM" — sert à peupler le sélecteur de mois.
export function derniersMois(n = 12): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export interface MonthlyBreakdownRow {
  mois: string; // "YYYY-MM"
  moisLabel: string; // "Août 2026"
  production: number;
  packsVendus: number;
  bonusOfferts: number;
  mouvementStockNet: number;
  ca: number;
  encaisse: number;
  depenses: number;
  mouvementCaisseNet: number;
}

// Synthèse mois par mois — des FLUX qui se remettent à zéro pour chaque
// mois (pas des balances, voir CLAUDE.md "Balance vs flux"). Sert à suivre
// l'évolution dans le temps (ex: export Excel), à ne pas confondre avec
// computeSoldeCaisseActuel/computeStockRestant qui donnent l'état actuel
// cumulé depuis le début.
export function computeMonthlyBreakdown(DB: Database): MonthlyBreakdownRow[] {
  const moisSet = new Set<string>();
  const addMonth = (date?: string) => {
    if (date && date.length >= 7) moisSet.add(date.slice(0, 7));
  };
  DB.ventes.forEach((v) => addMonth(v.date));
  DB.production.forEach((p) => addMonth(p.date));
  DB.depenses.forEach((d) => addMonth(d.date));
  DB.recouvrements.forEach((r) => addMonth(r.date));

  const mois = Array.from(moisSet).sort(); // "YYYY-MM" se trie correctement en texte

  return mois.map((m) => {
    const inMonth = (date?: string) => !!date && date.startsWith(m);

    const ventesMois = DB.ventes.filter((v) => inMonth(v.date));
    const productionMois = DB.production.filter((p) => inMonth(p.date));
    const depensesMois = DB.depenses.filter((d) => inMonth(d.date));
    const recouvMois = DB.recouvrements.filter((r) => inMonth(r.date));
    const apportsMois = (((DB as any).apports || []) as { date: string; montant: number }[]).filter((a) => inMonth(a.date));
    const vehiculeOpsMois = DB.vehiculeOps.filter((op) => inMonth(op.date));
    const maintenanceMois = DB.maintenance.filter((mt) => inMonth(mt.date) && mt.cout > 0);
    const versementsMois = DB.versements.filter((v) => inMonth(v.date));

    const production = productionMois.reduce((s, p) => s + (p.packs || 0), 0);
    const packsVendus = ventesMois.reduce((s, v) => s + (v.packs || 0), 0);
    const bonusOfferts = ventesMois.reduce((s, v) => s + bonusVente(v, DB), 0);
    const mouvementStockNet = production - (packsVendus + bonusOfferts);

    const ca = ventesMois.reduce((s, v) => s + v.packs * v.prix, 0);
    const encaisse =
      ventesMois.reduce((s, v) => s + cashAtSale(v, DB), 0) +
      recouvMois.reduce((s, r) => s + r.montant, 0);
    const depenses = depensesMois.reduce((s, d) => s + d.montant, 0);

    const vehiculeOpsNonComptees = vehiculeOpsMois.filter((op) => {
      const categorie = op.type === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule";
      return !depensesMois.some((d) => d.date === op.date && d.montant === op.montant && d.categorie === categorie);
    });
    const maintenanceNonComptee = maintenanceMois.filter(
      (mt) => !depensesMois.some((d) => d.date === mt.date && d.montant === mt.cout && d.categorie === "Maintenance machine")
    );
    const totalApports = apportsMois.reduce((s, a) => s + a.montant, 0);
    const totalVersements = versementsMois.reduce((s, v) => s + v.montant, 0);

    const entreesCaisse = encaisse + totalApports;
    const sortiesCaisse =
      depenses +
      vehiculeOpsNonComptees.reduce((s, op) => s + op.montant, 0) +
      maintenanceNonComptee.reduce((s, mt) => s + mt.cout, 0) +
      totalVersements;
    const mouvementCaisseNet = entreesCaisse - sortiesCaisse;

    return {
      mois: m,
      moisLabel: moisLabel(m),
      production,
      packsVendus,
      bonusOfferts,
      mouvementStockNet,
      ca,
      encaisse,
      depenses,
      mouvementCaisseNet,
    };
  });
}

// Comme derniersMois(), mais s'arrête à `minMois` (inclus) au lieu de
// toujours remonter n mois en arrière — sert à ne proposer dans le
// sélecteur que les mois où l'app a réellement été utilisée (ex: si la
// saisie a commencé en juillet 2026, les mois d'avant n'apparaissent pas,
// plutôt que d'afficher des mois vides à 0 qui donnent l'impression à tort
// qu'il n'y avait pas d'activité ces mois-là).
export function moisDepuis(minMois: string, maxMonths = 36): string[] {
  const months: string[] = [];
  const now = new Date();
  const [minY, minM] = (minMois || "").split("-").map(Number);
  for (let i = 0; i < maxMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    if (minY && minM && d.getFullYear() === minY && d.getMonth() + 1 === minM) break;
  }
  return months;
}

// Mois (YYYY-MM) le plus ancien parmi une liste de dates (YYYY-MM-DD) — sert
// à déterminer à partir de quand une rubrique a des données réelles, pour ne
// pas proposer de mois antérieurs vides dans le sélecteur.
export function premierMoisAvecDonnees(dates: (string | undefined)[]): string {
  const valid = dates.filter((d): d is string => !!d && d.length >= 7);
  if (valid.length === 0) return getMoisCourant();
  const min = valid.reduce((a, b) => (a < b ? a : b));
  return min.slice(0, 7);
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return "Inconnu";
}

export const ADMIN_EMAILS = ["ziza220@gmail.com"];

// Catégories de dépenses (DepensesSection.tsx) — sortie ici plutôt que
// définie localement dans le composant pour que ParametresSection.tsx
// (configuration du budget par catégorie, Etude-Depenses-AquaSachet.docx
// §4.2) puisse la réutiliser sans importer tout le module DepensesSection
// (ce qui casserait le lazy-loading par section de SectionPage.tsx). Une
// seule liste, un seul endroit à mettre à jour si les catégories changent
// (voir constat "Catégories figées dans le code" de l'étude, §3).
//
// "Énergie" scindée en trois catégories le 2026-08-21 (demande utilisateur,
// après avoir constaté un dépassement de budget sur "Énergie" sans pouvoir
// distinguer facture d'électricité, eau et carburant du groupe électrogène
// dans le suivi budgétaire) : "Facture électricité / Woyofal", "Facture eau
// (SEN EAU)" et "Carburant (groupe électrogène)" — la 3e catégorie (eau) a
// été ajoutée après coup, l'utilisateur ayant repéré une dépense "PAIEMENT
// SEN EAU" mal reclassée en carburant par la suggestion automatique (voir
// suggererCategorieEnergie() dans DepensesSection.tsx). "Carburant (groupe
// électrogène)" reste bien distinct de "Carburant véhicule" (catégorie
// auto-générée par VehiculesSection.tsx pour le carburant des camions, non
// sélectionnable ici). "Énergie" n'est plus dans cette liste (donc plus
// sélectionnable pour une NOUVELLE dépense), mais reste une valeur valide
// sur les dépenses déjà enregistrées avant ce changement — tant qu'elles
// n'ont pas été reclassées via l'outil "Reclasser Énergie" de
// DepensesSection.tsx, mapCategorieToCompte() dans exportComptable.ts sait
// encore la mapper (compte OHADA 6051, comme les trois nouvelles).
export const CATEGORIES_DEPENSES = ["Matière première","Facture électricité / Woyofal","Facture eau (SEN EAU)","Carburant (groupe électrogène)","Salaires","Transport","Emballage","Entretien","Loyer","Communication","Impôts","Divers"];

export const ROLE_SECTIONS: Record<string, string[]> = {
  admin: [
    "dashboard",
    "production",
    "ventes",
    "commandes",
    "clients",
    "commerciaux",
    "livreurs",
    "producteurs",
    "employes",
    "actionnaires",
    "objectifs",
    "depenses",
    "caisse",
    "creances",
    "recouvrement",
    "livraisons",
    "stock",
    "reconciliation",
    "suiviLogistique",
    "maintenance",
    "versements",
    "apports",
    "analytique",
    "vehicules",
    "corbeille",
    "rapport",
    "journal",
    "securite",
    "backups",
    "utilisateurs",
    "parametres",
    "cloture",
    "historique",
    "approbations",
    "comptabilite",
    "monitoring",
    "strategie",
  ],
  caissier: [
    "dashboard",
    "production",
    "ventes",
    "commandes",
    "clients",
    "commerciaux",
    "livreurs",
    "producteurs",
    "employes",
    "objectifs",
    "depenses",
    "caisse",
    "creances",
    "recouvrement",
    "livraisons",
    "stock",
    "reconciliation",
    "suiviLogistique",
    "maintenance",
    "versements",
    "apports",
    "rapport",
    "approbations",
  ],
  commercial: ["dashboard", "ventes", "commandes", "clients", "rapport", "approbations"],
  lecteur: [
    "dashboard",
    "production",
    "ventes",
    "clients",
    "commerciaux",
    "depenses",
    "caisse",
    "creances",
    "rapport",
    "approbations",
  ],
};

export const DEFAULT_DB: Database = {
  production: [],
  ventes: [],
  commandes: [],
  clients: [],
  commerciaux: [],
  livreurs: [],
  producteurs: [],
  employes: [],
  actionnaires: [],
  mouvementsActionnaires: [],
  depenses: [],
  livraisons: [],
  emballages: [],
  recouvrements: [],
  avances: [],
  maintenance: [],
  versements: [],
  apports: [],
  corbeille: [],
  vehicules: [],
  vehiculeOps: [],
  backups: [],
  journal: [],
  history: [],
  notifications: [],
  mouvementsStock: [],
  mouvementsStockArchive: [],
  reconciliations: [],
  stockControles: [],
  users: [],
  approvals: [],
  auditChain: [],
  // Valeurs alignées sur les réglages réels de production (mis à jour
  // 2026-08-05) plutôt que des valeurs génériques arbitraires. Raison : ces
  // valeurs par défaut servent de repli local tant que le vrai document
  // Firestore (meta/data.params ou params/global) n'a pas encore été chargé
  // dans la session — voir le bug de course corrigé le même jour (commits
  // 8bb3c3e / a69f763) qui pouvait silencieusement réécrire Firestore avec
  // ces valeurs par défaut avant la fin du chargement. En gardant le repli
  // identique aux vraies valeurs actuelles, une éventuelle réapparition de ce
  // genre de course n'aurait plus d'impact visible (écraser une valeur par
  // une valeur identique ne change rien), au lieu de faire régresser la
  // caisse ou la commission vers des chiffres génériques. Si ces réglages
  // métier changent légitimement plus tard (nouveau taux de commission,
  // etc.), ce repli doit être mis à jour en même temps.
  params: { taux: 25, tauxSachetsParKg: 17, soldeOuverture: 297023, prixRouleau: 3650, prixPack: 600, prixCarton: 3000, packsParCarton: 1000, bonusSeuil: 10 },
};
