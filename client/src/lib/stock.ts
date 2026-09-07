/**
 * Module Stock — Journal de mouvements, stock par emplacement, modèle produit
 * 
 * Ce module gère :
 * 1. Un journal de mouvements de stock (entrées/sorties avec motif)
 * 2. Le stock par emplacement (usine, dépôt, camions, clients consignation)
 * 3. Le modèle spécifique aux produits (sachets pleins, sachets vides, rouleaux plastique)
 */

import type { Database } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MouvementType =
  | "production"       // Production → entrée stock usine
  | "reception"         // Réception matière première (rouleaux) → entrée stock usine
  | "vente"            // Sortie stock → client
  | "retour"           // Retour client → stock
  | "casse"            // Perte/casse → sortie définitive
  | "don_police"       // Packs remis aux policiers par un livreur → sortie définitive
  | "ajustement"       // Correction manuelle (inventaire)
  | "chargement"       // Transfert usine → camion
  | "retour_camion"    // Retour camion → usine
  | "transfert"        // Transfert entre emplacements
  | "consommation"     // Consommation matière première (rouleaux → production)
  | "ouverture";       // Solde d'ouverture posé lors d'une réinitialisation du stock ("Nouveau départ")

export type Emplacement =
  | "usine"
  | "depot"
  | string; // Permet les camions dynamiques: "camion_xxx", "client_xxx"

export type ProduitType =
  | "sachet_plein"     // Sachet d'eau rempli (produit fini)
  | "sachet_vide"      // Emballage vide
  | "rouleau_plastique" // Matière première (kg)
  | "casier";          // Casier de transport

export interface MouvementStock {
  id: string;
  date: string;
  timestamp: string;
  type: MouvementType;
  produit: ProduitType;
  quantite: number;        // Toujours positif, le sens est donné par type
  unite: "packs" | "kg" | "unites";
  emplacementSource: Emplacement | null;  // null si entrée externe
  emplacementDest: Emplacement | null;    // null si sortie définitive
  reference: string;       // ID de la vente, production, etc.
  referenceLabel: string;  // Libellé lisible (ex: "VTE-042 - Client X")
  userName: string;
  notes: string;
  // Pour la réconciliation livraison
  livreurId?: string;
  vehiculeId?: string;
}

export interface StockEmplacement {
  emplacement: Emplacement;
  label: string;           // Nom lisible
  type: "usine" | "depot" | "camion" | "client";
  produit: ProduitType;
  quantite: number;
  unite: "packs" | "kg" | "unites";
}

// ─── Calculs de stock ────────────────────────────────────────────────────────

/**
 * Calcule le stock actuel par emplacement à partir du journal de mouvements
 */
export function calculerStockParEmplacement(mouvements: MouvementStock[]): StockEmplacement[] {
  const stockMap = new Map<string, StockEmplacement>();

  for (const m of mouvements) {
    // Sortie de la source
    if (m.emplacementSource) {
      const key = `${m.emplacementSource}|${m.produit}`;
      const existing = stockMap.get(key);
      if (existing) {
        existing.quantite -= m.quantite;
      } else {
        stockMap.set(key, {
          emplacement: m.emplacementSource,
          label: getEmplacementLabel(m.emplacementSource),
          type: getEmplacementType(m.emplacementSource),
          produit: m.produit,
          quantite: -m.quantite,
          unite: m.unite,
        });
      }
    }

    // Entrée dans la destination
    if (m.emplacementDest) {
      const key = `${m.emplacementDest}|${m.produit}`;
      const existing = stockMap.get(key);
      if (existing) {
        existing.quantite += m.quantite;
      } else {
        stockMap.set(key, {
          emplacement: m.emplacementDest,
          label: getEmplacementLabel(m.emplacementDest),
          type: getEmplacementType(m.emplacementDest),
          produit: m.produit,
          quantite: m.quantite,
          unite: m.unite,
        });
      }
    }
  }

  return Array.from(stockMap.values()).filter(s => s.quantite !== 0);
}

/**
 * Calcule le stock total d'un produit (tous emplacements confondus)
 */
export function stockTotalProduit(mouvements: MouvementStock[], produit: ProduitType): number {
  return calculerStockParEmplacement(mouvements)
    .filter(s => s.produit === produit)
    .reduce((total, s) => total + s.quantite, 0);
}

/**
 * Calcule le stock d'un produit dans un emplacement spécifique
 */
export function stockDansEmplacement(
  mouvements: MouvementStock[],
  produit: ProduitType,
  emplacement: Emplacement
): number {
  return calculerStockParEmplacement(mouvements)
    .filter(s => s.produit === produit && s.emplacement === emplacement)
    .reduce((total, s) => total + s.quantite, 0);
}

/**
 * Retourne les mouvements pour un emplacement donné (entrées et sorties)
 */
export function mouvementsParEmplacement(
  mouvements: MouvementStock[],
  emplacement: Emplacement
): MouvementStock[] {
  return mouvements.filter(
    m => m.emplacementSource === emplacement || m.emplacementDest === emplacement
  );
}

/**
 * Retourne les mouvements pour une date donnée
 */
export function mouvementsParDate(
  mouvements: MouvementStock[],
  date: string
): MouvementStock[] {
  return mouvements.filter(m => m.date === date);
}

// ─── Réconciliation livraison ────────────────────────────────────────────────

export interface ReconciliationLivraison {
  date: string;
  livreurId: string;
  livreurNom: string;
  vehiculeId?: string;
  vehiculeNom?: string;
  stockDepart: number;      // Packs chargés au départ
  ventesEffectuees: number; // Packs vendus
  retours: number;          // Packs retournés
  casse: number;            // Packs cassés/perdus
  donPolice: number;        // Packs remis aux policiers
  stockRetour: number;      // Packs réellement revenus
  encaissements: number;    // Montant encaissé (F)
  creditCree: number;       // Montant en crédit client (F)
  ecart: number;            // Écart inexpliqué (packs)
  ecartMontant: number;     // Écart en valeur (F)
  statut: "ok" | "ecart" | "non_reconcilie";
  explication?: string;     // Explication de l'écart si fournie
  reconciliePar?: string;
  reconcilieLe?: string;
}

/**
 * Calcule la réconciliation pour un livreur à une date donnée
 */
export function calculerReconciliation(
  mouvements: MouvementStock[],
  DB: Database,
  livreurId: string,
  date: string
): Partial<ReconciliationLivraison> {
  const mvtJour = mouvements.filter(m => m.date === date && m.livreurId === livreurId);

  const chargements = mvtJour
    .filter(m => m.type === "chargement" && m.produit === "sachet_plein")
    .reduce((s, m) => s + m.quantite, 0);

  const ventes = mvtJour
    .filter(m => m.type === "vente" && m.produit === "sachet_plein")
    .reduce((s, m) => s + m.quantite, 0);

  const retours = mvtJour
    .filter(m => m.type === "retour_camion" && m.produit === "sachet_plein")
    .reduce((s, m) => s + m.quantite, 0);

  const casse = mvtJour
    .filter(m => m.type === "casse" && m.produit === "sachet_plein")
    .reduce((s, m) => s + m.quantite, 0);

  const donPolice = mvtJour
    .filter(m => m.type === "don_police" && m.produit === "sachet_plein")
    .reduce((s, m) => s + m.quantite, 0);

  const ecart = chargements - ventes - retours - casse - donPolice;

  // Calculer encaissements et crédits des ventes du jour pour ce livreur
  const livreur = DB.livreurs.find(l => l.id === livreurId);
  const ventesJour = DB.ventes.filter(
    v => v.date === date && v.livreur === (livreur?.nom || "")
  );
  const encaissements = ventesJour.reduce((s, v) => s + (v.avance || (v.mode === "Payé" ? v.packs * v.prix : 0)), 0);
  const creditCree = ventesJour.reduce((s, v) => {
    const total = v.packs * v.prix;
    const avance = v.avance || (v.mode === "Payé" ? total : 0);
    return s + (total - avance);
  }, 0);

  return {
    date,
    livreurId,
    livreurNom: livreur?.nom || "Inconnu",
    stockDepart: chargements,
    ventesEffectuees: ventes,
    retours,
    casse,
    donPolice,
    stockRetour: retours,
    encaissements,
    creditCree,
    ecart,
    ecartMontant: ecart * (DB.params.prixPack || 600), // valorisation au prix de vente du pack
    statut: ecart === 0 ? "ok" : "ecart",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEmplacementLabel(emplacement: Emplacement): string {
  if (emplacement === "usine") return "Usine";
  if (emplacement === "depot") return "Dépôt";
  if (emplacement.startsWith("camion_")) return `Camion ${emplacement.replace("camion_", "")}`;
  if (emplacement.startsWith("client_")) return `Client ${emplacement.replace("client_", "")}`;
  return emplacement;
}

function getEmplacementType(emplacement: Emplacement): "usine" | "depot" | "camion" | "client" {
  if (emplacement === "usine") return "usine";
  if (emplacement === "depot") return "depot";
  if (emplacement.startsWith("camion_")) return "camion";
  if (emplacement.startsWith("client_")) return "client";
  return "depot";
}

export function getProduitLabel(produit: ProduitType): string {
  switch (produit) {
    case "sachet_plein": return "Sachets pleins (packs)";
    case "sachet_vide": return "Sachets vides";
    case "rouleau_plastique": return "Rouleaux plastique (kg)";
    case "casier": return "Casiers";
    default: return produit;
  }
}

export function getProduitUnite(produit: ProduitType): "packs" | "kg" | "unites" {
  switch (produit) {
    case "sachet_plein": return "packs";
    case "rouleau_plastique": return "kg";
    default: return "unites";
  }
}

/**
 * Créer un mouvement de stock à partir d'une production
 */
export function creerMouvementProduction(
  id: string,
  date: string,
  packs: number,
  userName: string,
  refId: string,
  refLabel: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "production",
    produit: "sachet_plein",
    quantite: packs,
    unite: "packs",
    emplacementSource: null,
    emplacementDest: "usine",
    reference: refId,
    referenceLabel: refLabel,
    userName,
    notes: "",
  };
}

/**
 * Créer un mouvement de stock à partir d'une vente
 */
export function creerMouvementVente(
  id: string,
  date: string,
  packs: number,
  userName: string,
  refId: string,
  refLabel: string,
  source: Emplacement = "usine",
  livreurId?: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "vente",
    produit: "sachet_plein",
    quantite: packs,
    unite: "packs",
    emplacementSource: source,
    emplacementDest: null,
    reference: refId,
    referenceLabel: refLabel,
    userName,
    notes: "",
    livreurId,
  };
}

/**
 * Créer un mouvement de chargement camion
 */
export function creerMouvementChargement(
  id: string,
  date: string,
  packs: number,
  userName: string,
  vehiculeId: string,
  livreurId: string,
  notes: string = ""
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "chargement",
    produit: "sachet_plein",
    quantite: packs,
    unite: "packs",
    emplacementSource: "usine",
    emplacementDest: `camion_${vehiculeId}`,
    reference: vehiculeId,
    referenceLabel: `Chargement camion`,
    userName,
    notes,
    livreurId,
    vehiculeId,
  };
}

/**
 * Créer un mouvement de retour camion
 */
export function creerMouvementRetourCamion(
  id: string,
  date: string,
  packs: number,
  userName: string,
  vehiculeId: string,
  livreurId: string,
  notes: string = ""
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "retour_camion",
    produit: "sachet_plein",
    quantite: packs,
    unite: "packs",
    emplacementSource: `camion_${vehiculeId}`,
    emplacementDest: "usine",
    reference: vehiculeId,
    referenceLabel: `Retour camion`,
    userName,
    notes,
    livreurId,
    vehiculeId,
  };
}

/**
 * Créer un mouvement de casse
 */
export function creerMouvementCasse(
  id: string,
  date: string,
  quantite: number,
  produit: ProduitType,
  emplacement: Emplacement,
  userName: string,
  notes: string,
  livreurId?: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "casse",
    produit,
    quantite,
    unite: getProduitUnite(produit),
    emplacementSource: emplacement,
    emplacementDest: null,
    reference: "",
    referenceLabel: "Casse/Perte",
    userName,
    notes,
    ...(livreurId && { livreurId }),
  };
}

/**
 * Créer un mouvement de don aux policiers.
 * Problème récurrent : les livreurs donnent souvent quelques packs aux
 * policiers (contrôles routiers). Ces packs doivent être défalqués du stock
 * comme une sortie définitive, tout en restant identifiables séparément
 * d'une vraie casse/perte, pour le suivi par livreur et la réconciliation.
 */
export function creerMouvementDonPolice(
  id: string,
  date: string,
  quantite: number,
  emplacement: Emplacement,
  userName: string,
  notes: string,
  livreurId?: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "don_police",
    produit: "sachet_plein",
    quantite,
    unite: "packs",
    emplacementSource: emplacement,
    emplacementDest: null,
    reference: "",
    referenceLabel: "Don aux policiers",
    userName,
    notes,
    ...(livreurId && { livreurId }),
  };
}

/**
 * Créer un mouvement de réception matière première
 */
export function creerMouvementReception(
  id: string,
  date: string,
  kg: number,
  userName: string,
  refId: string,
  fournisseur: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "reception",
    produit: "rouleau_plastique",
    quantite: kg,
    unite: "kg",
    emplacementSource: null,
    emplacementDest: "usine",
    reference: refId,
    referenceLabel: `Réception ${fournisseur}`,
    userName,
    notes: "",
  };
}

/**
 * Créer un mouvement de consommation matière première (production)
 */
export function creerMouvementConsommation(
  id: string,
  date: string,
  kg: number,
  userName: string,
  refId: string,
  refLabel: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "consommation",
    produit: "rouleau_plastique",
    quantite: kg,
    unite: "kg",
    emplacementSource: "usine",
    emplacementDest: null,
    reference: refId,
    referenceLabel: refLabel,
    userName,
    notes: "",
  };
}

/**
 * Créer un mouvement de solde d'ouverture (réinitialisation du stock).
 * Toujours une entrée pure dans l'emplacement donné : sert à poser une
 * nouvelle quantité de départ, vérifiée physiquement, sans avoir à rejouer
 * (ni à comprendre) tout l'historique de mouvements qui la précède. Voir
 * "Nouveau départ" dans StockSection.tsx.
 */
export function creerMouvementOuverture(
  id: string,
  date: string,
  quantite: number,
  produit: ProduitType,
  emplacement: Emplacement,
  userName: string,
  notes: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "ouverture",
    produit,
    quantite,
    unite: getProduitUnite(produit),
    emplacementSource: null,
    emplacementDest: emplacement,
    reference: "",
    referenceLabel: `Solde d'ouverture (nouveau départ)`,
    userName,
    notes,
  };
}

/**
 * Créer un mouvement d'ajustement (inventaire)
 */
export function creerMouvementAjustement(
  id: string,
  date: string,
  quantite: number,
  produit: ProduitType,
  emplacement: Emplacement,
  sens: "entree" | "sortie",
  userName: string,
  notes: string
): MouvementStock {
  return {
    id,
    date,
    timestamp: new Date().toISOString(),
    type: "ajustement",
    produit,
    quantite,
    unite: getProduitUnite(produit),
    emplacementSource: sens === "sortie" ? emplacement : null,
    emplacementDest: sens === "entree" ? emplacement : null,
    reference: "",
    referenceLabel: `Ajustement inventaire`,
    userName,
    notes,
  };
}
