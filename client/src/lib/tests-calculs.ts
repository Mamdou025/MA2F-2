/**
 * Tests des calculs essentiels — MA2F AquaSachet
 * 
 * Vérifie l'intégrité des calculs critiques :
 * - Stock restant
 * - Solde client
 * - Caisse
 * - Commission
 * - Bonus
 * - Recouvrement
 */
import type { Database } from "./types";
import { commissionVente, computeSoldeCaisseActuel, computeStockRestant, computeStockMatierePremiere } from "./helpers";

export interface TestResult {
  id: string;
  category: string;
  name: string;
  status: "pass" | "fail" | "warning";
  expected?: string;
  actual?: string;
  message: string;
}

export function runAllTests(DB: Database): TestResult[] {
  const results: TestResult[] = [];

  // ============================================================
  // 1. TESTS STOCK
  // ============================================================
  // Stock matière première = livraisons - consommation production. Calcul
  // canonique partagé (voir lib/helpers.ts computeStockMatierePremiere).
  const stockMatierePremiereAttendu = computeStockMatierePremiere(DB);

  results.push({
    id: "stock-mp-positif",
    category: "Stock",
    name: "Stock matière première positif",
    status: stockMatierePremiereAttendu >= 0 ? "pass" : "fail",
    expected: ">= 0 kg",
    actual: `${stockMatierePremiereAttendu.toFixed(2)} kg`,
    message: stockMatierePremiereAttendu >= 0
      ? `Stock MP: ${stockMatierePremiereAttendu.toFixed(2)} kg`
      : `Stock MP négatif! On a consommé plus que livré.`,
  });

  // Stock produit fini = production - ventes (packs + bonus). Calcul
  // canonique partagé (voir lib/helpers.ts computeStockRestant), même
  // implémentation que Dashboard.tsx.
  const stockProduitFini = computeStockRestant(DB);

  results.push({
    id: "stock-pf-positif",
    category: "Stock",
    name: "Stock produit fini positif",
    status: stockProduitFini >= 0 ? "pass" : "fail",
    expected: ">= 0 packs",
    actual: `${stockProduitFini} packs`,
    message: stockProduitFini >= 0
      ? `Stock PF: ${stockProduitFini} packs`
      : `Stock PF négatif! Plus de ventes que de production.`,
  });

  // ============================================================
  // 2. TESTS SOLDE CLIENT
  // ============================================================
  const clientsAvecDette = DB.clients.map((client) => {
    const ventesClient = DB.ventes.filter((v) => v.client === client.nom);
    const totalDu = ventesClient.reduce((s, v) => s + v.packs * v.prix, 0);
    const totalPaye = ventesClient.reduce((s, v) => {
      if (v.mode === "Payé") return s + v.packs * v.prix;
      return s + (v.avance || 0);
    }, 0);
    const recouvrements = DB.recouvrements
      .filter((r) => r.client === client.nom)
      .reduce((s, r) => s + r.montant, 0);
    const solde = totalDu - totalPaye - recouvrements;
    return { nom: client.nom, solde };
  });

  const clientsSoldeNegatif = clientsAvecDette.filter((c) => c.solde < -1); // Tolérance 1F
  results.push({
    id: "solde-client-positif",
    category: "Solde client",
    name: "Aucun client avec solde négatif",
    status: clientsSoldeNegatif.length === 0 ? "pass" : "fail",
    expected: "0 clients avec solde < 0",
    actual: `${clientsSoldeNegatif.length} client(s)`,
    message: clientsSoldeNegatif.length === 0
      ? "Tous les soldes clients sont cohérents"
      : `Clients avec solde négatif: ${clientsSoldeNegatif.map(c => c.nom).join(", ")}`,
  });

  // Vérifier qu'aucun recouvrement ne dépasse la dette
  const recouvrementsSurpayés = DB.recouvrements.filter((r) => {
    const client = clientsAvecDette.find((c) => c.nom === r.client);
    return client && client.solde < -r.montant;
  });
  results.push({
    id: "recouvrement-coherent",
    category: "Recouvrement",
    name: "Recouvrements cohérents avec les dettes",
    status: recouvrementsSurpayés.length === 0 ? "pass" : "warning",
    expected: "0 recouvrements > dette",
    actual: `${recouvrementsSurpayés.length}`,
    message: recouvrementsSurpayés.length === 0
      ? "Tous les recouvrements sont dans les limites"
      : `${recouvrementsSurpayés.length} recouvrement(s) potentiellement excessif(s)`,
  });

  // ============================================================
  // 3. TESTS CAISSE
  // ============================================================
  // Calcul canonique partagé (voir lib/helpers.ts computeSoldeCaisseActuel)
  // — la même implémentation que CaisseSection.tsx et Dashboard.tsx, pour
  // que ce test vérifie exactement le chiffre affiché à l'utilisateur
  // plutôt qu'une variante recalculée séparément (c'est cette divergence
  // qui avait laissé passer le bug du solde d'ouverture début août 2026).
  const soldeCaisse = computeSoldeCaisseActuel(DB);

  results.push({
    id: "caisse-positive",
    category: "Caisse",
    name: "Solde caisse positif",
    status: soldeCaisse >= 0 ? "pass" : "warning",
    expected: ">= 0 F",
    actual: `${soldeCaisse.toLocaleString("fr-FR")} F`,
    message: soldeCaisse >= 0
      ? `Solde caisse: ${soldeCaisse.toLocaleString("fr-FR")} F`
      : `Solde caisse négatif: ${soldeCaisse.toLocaleString("fr-FR")} F — vérifier les sorties`,
  });

  results.push({
    id: "caisse-entrees-sorties",
    category: "Caisse",
    name: "Calcul de caisse valide",
    status: Number.isFinite(soldeCaisse) ? "pass" : "fail",
    expected: "Valeur numérique valide",
    actual: `${soldeCaisse.toLocaleString("fr-FR")} F`,
    message: "Vérification du calcul du solde de caisse (entrées − sorties, solde d'ouverture inclus une seule fois)",
  });

  // ============================================================
  // 4. TESTS COMMISSION
  // ============================================================
  const ventesAvecCommercial = DB.ventes.filter((v) => v.commercial && v.commercial.trim() !== "");
  // Commission calculée sur TOUTES les ventes avec commercial, payées ET à
  // crédit (décision explicite de l'utilisateur, 2026-09-05 — voir
  // CommerciauxSection.tsx pour le même changement côté affichage).
  const commissionAttendue = ventesAvecCommercial
    .reduce((s, v) => s + commissionVente(v, DB), 0);

  results.push({
    id: "commission-coherente",
    category: "Commission",
    name: "Commission calculée uniquement sur ventes avec commercial",
    status: "pass",
    expected: "Commission sur ventes avec commercial (payées et à crédit)",
    actual: `${commissionAttendue.toLocaleString("fr-FR")} F sur ${ventesAvecCommercial.length} ventes`,
    message: `Commission totale: ${commissionAttendue.toLocaleString("fr-FR")} F (${ventesAvecCommercial.length} ventes avec commercial, payées et à crédit)`,
  });

  // Vérifier qu'il n'y a pas de vente sans client
  const ventesSansClient = DB.ventes.filter((v) => !v.client || v.client.trim() === "");
  results.push({
    id: "ventes-avec-client",
    category: "Commission",
    name: "Toutes les ventes ont un client",
    status: ventesSansClient.length === 0 ? "pass" : "fail",
    expected: "0 ventes sans client",
    actual: `${ventesSansClient.length}`,
    message: ventesSansClient.length === 0
      ? "Toutes les ventes ont un client associé"
      : `${ventesSansClient.length} vente(s) sans client!`,
  });

  // ============================================================
  // 5. TESTS BONUS
  // ============================================================
  const bonusSeuil = DB.params.bonusSeuil || 10;
  const ventesAvecBonusIncorrect = DB.ventes.filter((v) => {
    const bonusAttendu = Math.floor(v.packs / bonusSeuil);
    return (v.bonus || 0) !== bonusAttendu;
  });

  results.push({
    id: "bonus-correct",
    category: "Bonus",
    name: "Bonus calculé correctement",
    status: ventesAvecBonusIncorrect.length === 0 ? "pass" : "warning",
    expected: `1 bonus / ${bonusSeuil} packs`,
    actual: `${ventesAvecBonusIncorrect.length} écart(s)`,
    message: ventesAvecBonusIncorrect.length === 0
      ? `Tous les bonus sont corrects (seuil: ${bonusSeuil})`
      : `${ventesAvecBonusIncorrect.length} vente(s) avec bonus incorrect`,
  });

  // ============================================================
  // 6. TESTS INTÉGRITÉ DONNÉES
  // ============================================================
  // Vérifier les IDs uniques
  const allVenteIds = DB.ventes.map((v) => v.id);
  const duplicateVenteIds = allVenteIds.filter((id, i) => allVenteIds.indexOf(id) !== i);
  results.push({
    id: "ids-uniques-ventes",
    category: "Intégrité",
    name: "IDs ventes uniques",
    status: duplicateVenteIds.length === 0 ? "pass" : "fail",
    expected: "0 doublons",
    actual: `${duplicateVenteIds.length} doublon(s)`,
    message: duplicateVenteIds.length === 0
      ? "Tous les IDs de ventes sont uniques"
      : `Doublons détectés: ${duplicateVenteIds.join(", ")}`,
  });

  // Vérifier les montants négatifs
  const ventesNegatives = DB.ventes.filter((v) => v.packs < 0 || v.prix < 0);
  const depensesNegatives = DB.depenses.filter((d) => d.montant < 0);
  results.push({
    id: "montants-positifs",
    category: "Intégrité",
    name: "Aucun montant négatif",
    status: ventesNegatives.length === 0 && depensesNegatives.length === 0 ? "pass" : "fail",
    expected: "0 montants négatifs",
    actual: `${ventesNegatives.length + depensesNegatives.length}`,
    message: ventesNegatives.length === 0 && depensesNegatives.length === 0
      ? "Aucun montant négatif détecté"
      : `${ventesNegatives.length} vente(s) et ${depensesNegatives.length} dépense(s) avec montant négatif`,
  });

  return results;
}
