/**
 * Module d'export comptable conforme SYSCOHADA — MA2F AquaSachet
 * 
 * Génère les écritures comptables selon le Plan Comptable Général OHADA :
 * - Journal des ventes
 * - Journal de caisse
 * - Journal des achats
 * - Grand livre
 * - Balance générale
 * 
 * Comptes utilisés (Plan OHADA) :
 * 411 - Clients
 * 521 - Banques locales
 * 571 - Caisse
 * 601 - Achats de matières premières
 * 701 - Ventes de produits finis
 * 6311 - Frais de transport
 * 6581 - Charges diverses
 * 6611 - Rémunérations du personnel
 * 658 - Charges diverses d'exploitation
 */

import type { Database } from "./types";
import { commissionVente } from "./helpers";

// ─── Plan comptable OHADA simplifié ──────────────────────────────────────────

export const PLAN_COMPTABLE = {
  "411": { label: "Clients", nature: "actif" },
  "401": { label: "Fournisseurs", nature: "passif" },
  "455": { label: "Comptes courants des associés", nature: "passif" },
  "521": { label: "Banques locales", nature: "actif" },
  "571": { label: "Caisse", nature: "actif" },
  "601": { label: "Achats de matières premières", nature: "charge" },
  "6031": { label: "Variations de stocks de matières premières", nature: "charge" },
  "6032": { label: "Achats d'emballages", nature: "charge" },
  "605": { label: "Achats de fournitures non stockées", nature: "charge" },
  "6051": { label: "Énergie, eau", nature: "charge" },
  "615": { label: "Entretien et réparations", nature: "charge" },
  "622": { label: "Locations", nature: "charge" },
  "6241": { label: "Frais de transport sur achats", nature: "charge" },
  "6265": { label: "Frais de télécommunications", nature: "charge" },
  "6311": { label: "Frais de transport sur ventes", nature: "charge" },
  "641": { label: "Impôts et taxes", nature: "charge" },
  "6411": { label: "Commissions sur ventes", nature: "charge" },
  "6581": { label: "Charges diverses", nature: "charge" },
  "6611": { label: "Rémunérations du personnel", nature: "charge" },
  "658": { label: "Charges diverses d'exploitation", nature: "charge" },
  "681": { label: "Dotations aux amortissements", nature: "charge" },
  "701": { label: "Ventes de produits finis", nature: "produit" },
  "740": { label: "Subventions d'exploitation", nature: "produit" },
  "7078": { label: "Autres produits accessoires", nature: "produit" },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EcritureComptable {
  date: string;
  journal: "VE" | "CA" | "AC" | "OD"; // Ventes, Caisse, Achats, Opérations Diverses
  piece: string;
  libelle: string;
  compteDebit: string;
  compteCredit: string;
  montant: number;
  reference?: string;
}

export interface LigneGrandLivre {
  date: string;
  libelle: string;
  piece: string;
  debit: number;
  credit: number;
  solde: number;
}

export interface LigneBalance {
  compte: string;
  libelle: string;
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

export interface RapportComptable {
  periode: { debut: string; fin: string };
  ecritures: EcritureComptable[];
  grandLivre: Record<string, LigneGrandLivre[]>;
  balance: LigneBalance[];
  totaux: {
    totalDebit: number;
    totalCredit: number;
    resultat: number;
  };
}

// ─── Génération des écritures ────────────────────────────────────────────────

/**
 * Génère les écritures comptables à partir des données de l'application
 */
export function genererEcritures(db: Database, dateDebut: string, dateFin: string): EcritureComptable[] {
  const ecritures: EcritureComptable[] = [];
  let pieceNum = 1;

  const nextPiece = (prefix: string) => `${prefix}-${String(pieceNum++).padStart(4, "0")}`;

  // 1. JOURNAL DES VENTES (VE)
  const ventesFiltered = (db.ventes || []).filter((v) => v.date >= dateDebut && v.date <= dateFin);
  for (const vente of ventesFiltered) {
    const montantTotal = vente.packs * vente.prix;
    const piece = nextPiece("VE");

    if (vente.mode === "Payé") {
      // Vente au comptant : Débit 571 Caisse / Crédit 701 Ventes
      ecritures.push({
        date: vente.date,
        journal: "VE",
        piece,
        libelle: `Vente ${vente.packs} packs à ${vente.client}`,
        compteDebit: "571",
        compteCredit: "701",
        montant: montantTotal,
        reference: vente.id,
      });
    } else {
      // Vente à crédit : Débit 411 Clients / Crédit 701 Ventes
      ecritures.push({
        date: vente.date,
        journal: "VE",
        piece,
        libelle: `Vente à crédit ${vente.packs} packs à ${vente.client}`,
        compteDebit: "411",
        compteCredit: "701",
        montant: montantTotal,
        reference: vente.id,
      });

      // Si avance : Débit 571 Caisse / Crédit 411 Clients
      if (vente.avance && vente.avance > 0) {
        ecritures.push({
          date: vente.date,
          journal: "CA",
          piece: nextPiece("CA"),
          libelle: `Avance reçue de ${vente.client}`,
          compteDebit: "571",
          compteCredit: "411",
          montant: vente.avance,
          reference: vente.id,
        });
      }
    }

    // Commission commercial : uniquement sur les ventes en mode "Payé"
    // (règle métier de l'application — voir Paramètres > Commission commerciaux :
    // "Commission versée au commercial par pack vendu en mode 'Payé'.
    // Pas de commission si aucun commercial n'est mentionné sur la vente.")
    if (vente.mode === "Payé" && vente.commercial && vente.commercial.trim() !== "") {
      // Taux figé sur la vente (tauxCommission) si présent, sinon le taux
      // courant — voir commissionVente() dans helpers.ts.
      const commission = commissionVente(vente, db);
      ecritures.push({
        date: vente.date,
        journal: "OD",
        piece: nextPiece("OD"),
        libelle: `Commission ${vente.commercial} sur vente ${vente.client}`,
        compteDebit: "6411",
        compteCredit: "571",
        montant: commission,
        reference: vente.id,
      });
    }
  }

  // 2. JOURNAL DE CAISSE — Recouvrements
  const recouvrementsFiltered = (db.recouvrements || []).filter((r) => r.date >= dateDebut && r.date <= dateFin);
  for (const rec of recouvrementsFiltered) {
    ecritures.push({
      date: rec.date,
      journal: "CA",
      piece: nextPiece("CA"),
      libelle: `Recouvrement ${rec.client}`,
      compteDebit: "571",
      compteCredit: "411",
      montant: rec.montant,
      reference: rec.id,
    });
  }

  // 3. JOURNAL DES ACHATS — Réceptions rouleaux
  // NOTE : il n'y a PAS de boucle directe sur db.livraisons ici. Chaque réception
  // génère déjà automatiquement une dépense (catégorie "Matière première") au
  // moment où l'argent sort réellement de la caisse — immédiatement si payée cash,
  // ou plus tard au moment du paiement si à crédit (voir LivraisonsSection).
  // Boucler aussi sur db.livraisons ici doublerait la charge 601 pour toute
  // réception payée cash, et créditerait 571 (Caisse) pour des réceptions à
  // crédit non encore payées — deux erreurs corrigées en s'appuyant uniquement
  // sur la boucle Dépenses ci-dessous (comptabilité en base caisse).

  // 4. JOURNAL DE CAISSE — Dépenses
  const depensesFiltered = (db.depenses || []).filter((d) => d.date >= dateDebut && d.date <= dateFin);
  for (const dep of depensesFiltered) {
    const compteCharge = mapCategorieToCompte(dep.categorie);
    ecritures.push({
      date: dep.date,
      journal: "CA",
      piece: nextPiece("CA"),
      libelle: `${dep.categorie}: ${dep.libelle}`,
      compteDebit: compteCharge,
      compteCredit: "571",
      montant: dep.montant,
      reference: dep.id,
    });
  }

  // 5. Opérations véhicules & Maintenance
  // NOTE : idem — VehiculesSection et MaintenanceSection créent chacune
  // automatiquement une dépense correspondante (catégories "Carburant véhicule",
  // "Maintenance véhicule", "Maintenance machine") dès l'enregistrement de
  // l'opération. Ces dépenses sont déjà comptabilisées par la boucle ci-dessus ;
  // ne pas boucler aussi sur db.vehiculeOps / db.maintenance ici, sous peine de
  // compter chaque opération deux fois.

  // 6. JOURNAL DE CAISSE — Versements (sorties : banque, personne, salaire, commission...)
  const versementsFiltered = (db.versements || []).filter((v) => v.date >= dateDebut && v.date <= dateFin);
  for (const vers of versementsFiltered) {
    const compteDebit = mapVersementTypeToCompte(vers.type);
    ecritures.push({
      date: vers.date,
      journal: "CA",
      piece: nextPiece("CA"),
      libelle: `Versement ${vers.type} — ${vers.beneficiaire}${vers.notes ? " (" + vers.notes + ")" : ""}`,
      compteDebit,
      compteCredit: "571",
      montant: vers.montant,
      reference: vers.id,
    });
  }

  // 7. JOURNAL DE CAISSE — Apports de fonds (entrées : appel de fonds, apport associé, subvention...)
  const apportsFiltered = ((db as any).apports || []).filter((a: any) => a.date >= dateDebut && a.date <= dateFin);
  for (const apport of apportsFiltered) {
    const compteCredit = apport.type === "Subvention" ? "740" : "455";
    ecritures.push({
      date: apport.date,
      journal: "CA",
      piece: nextPiece("CA"),
      libelle: `Apport ${apport.type} — ${apport.source}${apport.reference ? " (" + apport.reference + ")" : ""}`,
      compteDebit: "571",
      compteCredit,
      montant: apport.montant,
      reference: apport.id,
    });
  }

  return ecritures.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Grand Livre ─────────────────────────────────────────────────────────────

/**
 * Génère le grand livre à partir des écritures
 */
export function genererGrandLivre(ecritures: EcritureComptable[]): Record<string, LigneGrandLivre[]> {
  const grandLivre: Record<string, LigneGrandLivre[]> = {};

  for (const ecriture of ecritures) {
    // Compte au débit
    if (!grandLivre[ecriture.compteDebit]) grandLivre[ecriture.compteDebit] = [];
    grandLivre[ecriture.compteDebit].push({
      date: ecriture.date,
      libelle: ecriture.libelle,
      piece: ecriture.piece,
      debit: ecriture.montant,
      credit: 0,
      solde: 0,
    });

    // Compte au crédit
    if (!grandLivre[ecriture.compteCredit]) grandLivre[ecriture.compteCredit] = [];
    grandLivre[ecriture.compteCredit].push({
      date: ecriture.date,
      libelle: ecriture.libelle,
      piece: ecriture.piece,
      debit: 0,
      credit: ecriture.montant,
      solde: 0,
    });
  }

  // Calculer les soldes cumulés
  for (const compte of Object.keys(grandLivre)) {
    let solde = 0;
    for (const ligne of grandLivre[compte]) {
      solde += ligne.debit - ligne.credit;
      ligne.solde = solde;
    }
  }

  return grandLivre;
}

// ─── Balance Générale ────────────────────────────────────────────────────────

/**
 * Génère la balance générale à partir du grand livre
 */
export function genererBalance(grandLivre: Record<string, LigneGrandLivre[]>): LigneBalance[] {
  const balance: LigneBalance[] = [];

  for (const [compte, lignes] of Object.entries(grandLivre)) {
    const totalDebit = lignes.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lignes.reduce((sum, l) => sum + l.credit, 0);
    const solde = totalDebit - totalCredit;

    balance.push({
      compte,
      libelle: (PLAN_COMPTABLE as any)[compte]?.label || `Compte ${compte}`,
      totalDebit,
      totalCredit,
      soldeDebiteur: solde > 0 ? solde : 0,
      soldeCrediteur: solde < 0 ? Math.abs(solde) : 0,
    });
  }

  return balance.sort((a, b) => a.compte.localeCompare(b.compte));
}

// ─── Rapport complet ─────────────────────────────────────────────────────────

/**
 * Génère le rapport comptable complet pour une période
 */
export function genererRapportComptable(db: Database, dateDebut: string, dateFin: string): RapportComptable {
  const ecritures = genererEcritures(db, dateDebut, dateFin);
  const grandLivre = genererGrandLivre(ecritures);
  const balance = genererBalance(grandLivre);

  const totalDebit = balance.reduce((sum, l) => sum + l.totalDebit, 0);
  const totalCredit = balance.reduce((sum, l) => sum + l.totalCredit, 0);

  // Résultat = Produits - Charges
  const produits = balance
    .filter((l) => l.compte.startsWith("7"))
    .reduce((sum, l) => sum + l.totalCredit - l.totalDebit, 0);
  const charges = balance
    .filter((l) => l.compte.startsWith("6"))
    .reduce((sum, l) => sum + l.totalDebit - l.totalCredit, 0);

  return {
    periode: { debut: dateDebut, fin: dateFin },
    ecritures,
    grandLivre,
    balance,
    totaux: {
      totalDebit,
      totalCredit,
      resultat: produits - charges,
    },
  };
}

// ─── Export CSV ──────────────────────────────────────────────────────────────

/**
 * Exporte les écritures en format CSV compatible avec les logiciels comptables
 */
export function exporterCSV(ecritures: EcritureComptable[]): string {
  const header = "Date;Journal;Pièce;Libellé;Compte Débit;Compte Crédit;Montant;Référence";
  const lines = ecritures.map((e) =>
    [
      e.date,
      e.journal,
      e.piece,
      `"${e.libelle.replace(/"/g, '""')}"`,
      e.compteDebit,
      e.compteCredit,
      e.montant.toFixed(0),
      e.reference || "",
    ].join(";")
  );
  return [header, ...lines].join("\n");
}

/**
 * Exporte la balance en format CSV
 */
export function exporterBalanceCSV(balance: LigneBalance[]): string {
  const header = "Compte;Libellé;Total Débit;Total Crédit;Solde Débiteur;Solde Créditeur";
  const lines = balance.map((l) =>
    [
      l.compte,
      `"${l.libelle}"`,
      l.totalDebit.toFixed(0),
      l.totalCredit.toFixed(0),
      l.soldeDebiteur.toFixed(0),
      l.soldeCrediteur.toFixed(0),
    ].join(";")
  );

  // Totaux
  const totalDebit = balance.reduce((s, l) => s + l.totalDebit, 0);
  const totalCredit = balance.reduce((s, l) => s + l.totalCredit, 0);
  const totalSD = balance.reduce((s, l) => s + l.soldeDebiteur, 0);
  const totalSC = balance.reduce((s, l) => s + l.soldeCrediteur, 0);
  lines.push(["TOTAUX", '""', totalDebit.toFixed(0), totalCredit.toFixed(0), totalSD.toFixed(0), totalSC.toFixed(0)].join(";"));

  return [header, ...lines].join("\n");
}

/**
 * Exporte le grand livre en format texte structuré
 */
export function exporterGrandLivreTexte(grandLivre: Record<string, LigneGrandLivre[]>): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════════════════════");
  lines.push("                    GRAND LIVRE — MA2F AquaSachet");
  lines.push("                    Conforme Plan Comptable OHADA");
  lines.push("═══════════════════════════════════════════════════════════════════");
  lines.push("");

  const comptes = Object.keys(grandLivre).sort();
  for (const compte of comptes) {
    const label = (PLAN_COMPTABLE as any)[compte]?.label || `Compte ${compte}`;
    lines.push(`┌─── ${compte} — ${label} ${"─".repeat(Math.max(0, 50 - compte.length - label.length))}┐`);
    lines.push(`│ ${"Date".padEnd(12)} ${"Libellé".padEnd(35)} ${"Débit".padStart(12)} ${"Crédit".padStart(12)} ${"Solde".padStart(12)} │`);
    lines.push(`│${"─".repeat(87)}│`);

    for (const ligne of grandLivre[compte]) {
      lines.push(
        `│ ${ligne.date.padEnd(12)} ${ligne.libelle.slice(0, 35).padEnd(35)} ${formatMontant(ligne.debit).padStart(12)} ${formatMontant(ligne.credit).padStart(12)} ${formatMontant(ligne.solde).padStart(12)} │`
      );
    }

    const totalDebit = grandLivre[compte].reduce((s, l) => s + l.debit, 0);
    const totalCredit = grandLivre[compte].reduce((s, l) => s + l.credit, 0);
    const solde = totalDebit - totalCredit;
    lines.push(`│${"─".repeat(87)}│`);
    lines.push(
      `│ ${"TOTAL".padEnd(12)} ${"".padEnd(35)} ${formatMontant(totalDebit).padStart(12)} ${formatMontant(totalCredit).padStart(12)} ${formatMontant(solde).padStart(12)} │`
    );
    lines.push(`└${"─".repeat(87)}┘`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

// Doit couvrir exactement les catégories de DepensesSection.CATEGORIES,
// plus les catégories générées automatiquement par LivraisonsSection,
// VehiculesSection et MaintenanceSection (voir commentaires plus haut).
function mapCategorieToCompte(categorie: string): string {
  const mapping: Record<string, string> = {
    "Matière première": "601",
    // "Énergie" scindée le 2026-08-21 en trois catégories plus précises (voir
    // helpers.ts CATEGORIES_DEPENSES) — toutes trois mappées au même compte
    // 6051 (Énergie, eau — le libellé du compte couvre littéralement les
    // deux), comme l'ancienne catégorie unique. "Énergie" est conservée ici
    // pour les dépenses créées avant ce changement et pas encore reclassées
    // (voir "Reclasser Énergie" dans DepensesSection.tsx).
    "Énergie": "6051",
    "Facture électricité / Woyofal": "6051",
    "Facture eau (SEN EAU)": "6051",
    "Carburant (groupe électrogène)": "6051",
    "Salaires": "6611",
    "Transport": "6311",
    "Emballage": "6032",
    "Entretien": "615",
    "Loyer": "622",
    "Communication": "6265",
    "Impôts": "641",
    "Divers": "658",
    // Catégories auto-générées (non sélectionnables directement dans Dépenses)
    "Carburant véhicule": "6241",
    "Maintenance véhicule": "615",
    "Maintenance machine": "615",
  };
  return mapping[categorie] || "658";
}

// Versements : sortie de caisse vers différentes destinations.
// "Banque" est un simple transfert interne (pas une charge) ; les autres
// types représentent une charge réelle.
function mapVersementTypeToCompte(type: string): string {
  const mapping: Record<string, string> = {
    "Banque": "521",
    "Salaire": "6611",
    "Commission": "6411",
    "Personne": "658",
    "Autre": "658",
  };
  return mapping[type] || "658";
}

function formatMontant(montant: number): string {
  if (montant === 0) return "";
  return montant.toLocaleString("fr-FR");
}
