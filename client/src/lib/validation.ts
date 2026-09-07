/**
 * Système de validation métier centralisé — MA2F AquaSachet
 * 
 * Toutes les validations avant enregistrement sont regroupées ici.
 * Chaque fonction retourne un objet { valid, errors } où errors est un tableau de messages.
 */

import type { Database, Vente, Depense, Livraison, Maintenance, Versement, Production, Recouvrement } from "./types";
import { resteVente } from "./helpers";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================
// VALIDATION DES VENTES
// ============================================================
export function validateVente(
  data: Partial<Vente>,
  DB: Database,
  isEdit: boolean = false
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Client obligatoire
  if (!data.client || data.client.trim() === "") {
    errors.push("Le client est obligatoire.");
  }

  // Quantité vendue
  if (!data.packs || data.packs <= 0) {
    errors.push("La quantité de packs doit être supérieure à 0.");
  }
  if (data.packs && data.packs > 10000) {
    errors.push("Quantité anormale : plus de 10 000 packs. Vérifiez la saisie.");
  }

  // Prix unitaire
  if (!data.prix || data.prix <= 0) {
    errors.push("Le prix unitaire doit être supérieur à 0.");
  }
  if (data.prix && data.prix < 50) {
    warnings.push("Prix anormalement bas (< 50 F/pack). Vérifiez.");
  }
  if (data.prix && data.prix > 50000) {
    errors.push("Prix anormalement élevé (> 50 000 F/pack). Vérifiez la saisie.");
  }

  // Mode de paiement
  if (!data.mode) {
    errors.push("Le mode de paiement est obligatoire (Payé ou Crédit).");
  }

  // Avance cohérente
  if (data.mode === "Crédit" && data.avance !== undefined && data.avance !== null) {
    const montantTotal = (data.packs || 0) * (data.prix || 0);
    if (data.avance < 0) {
      errors.push("L'avance ne peut pas être négative.");
    }
    if (data.avance > montantTotal) {
      errors.push("L'avance ne peut pas dépasser le montant total de la vente.");
    }
  }

  // Livreur recommandé (warning, pas bloquant)
  if (!data.livreur || data.livreur.trim() === "") {
    warnings.push("Aucun livreur assigné. La livraison ne sera pas tracée.");
  }

  // Vérifier que le client existe dans la base
  if (data.client && DB.clients.length > 0) {
    const clientExists = DB.clients.some(
      (c) => c.nom.toLowerCase() === data.client!.toLowerCase()
    );
    if (!clientExists) {
      warnings.push("Ce client n'existe pas dans la base. Il sera créé automatiquement ou vérifiez l'orthographe.");
    }
  }

  // Plafond de crédit du client : avertit (sans bloquer) si cette vente à
  // crédit ferait dépasser le plafond défini sur la fiche client. Note :
  // en édition, le solde actuel de CETTE vente est inclus dans le total
  // existant (léger surcompte accepté, ce n'est qu'un avertissement).
  if (data.mode === "Crédit" && data.client) {
    const clientObj = DB.clients.find((c) => c.nom.toLowerCase() === data.client!.toLowerCase());
    if (clientObj?.plafondCredit && clientObj.plafondCredit > 0) {
      const soldeExistant = DB.ventes
        .filter((v) => v.client.toLowerCase() === data.client!.toLowerCase())
        .reduce((s, v) => s + resteVente(v, DB), 0);
      const montantTotal = (data.packs || 0) * (data.prix || 0);
      const impayeNouvelleVente = Math.max(0, montantTotal - (data.avance || 0));
      const soldeProjete = soldeExistant + impayeNouvelleVente;
      if (soldeProjete > clientObj.plafondCredit) {
        warnings.push(
          `Plafond de crédit dépassé pour ${clientObj.nom} : solde projeté ${soldeProjete.toLocaleString("fr-FR")} F > plafond ${clientObj.plafondCredit.toLocaleString("fr-FR")} F.`
        );
      }
    }
  }

  // Stock suffisant
  if (data.packs) {
    const totalProduit = DB.production.reduce((s, p) => s + p.packs, 0);
    const totalVendu = DB.ventes.reduce((s, v) => s + v.packs + (v.bonus || 0), 0);
    const stockDispo = totalProduit - totalVendu;
    if (data.packs > stockDispo) {
      warnings.push(`Stock insuffisant (${stockDispo} packs disponibles). La vente sera enregistrée mais le stock sera négatif.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// VALIDATION DES RECOUVREMENTS
// ============================================================
export function validateRecouvrement(
  data: Partial<Recouvrement>,
  DB: Database,
  venteId?: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Montant obligatoire et positif
  if (!data.montant || data.montant <= 0) {
    errors.push("Le montant du recouvrement doit être supérieur à 0.");
  }

  // Vérifier que le paiement ne dépasse pas la dette
  if (venteId && data.montant) {
    const vente = DB.ventes.find((v) => v.id === venteId);
    if (vente) {
      const montantTotal = vente.packs * vente.prix;
      const avance = vente.avance || (vente.mode === "Payé" ? montantTotal : 0);
      const recouvrements = DB.recouvrements
        .filter((r) => r.venteId === venteId)
        .reduce((s, r) => s + r.montant, 0);
      const resteAPayer = montantTotal - avance - recouvrements;

      if (data.montant > resteAPayer) {
        errors.push(`Le montant (${data.montant} F) dépasse le reste à payer (${resteAPayer} F).`);
      }
    }
  }

  // Date obligatoire
  if (!data.date) {
    errors.push("La date du recouvrement est obligatoire.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// VALIDATION DES DÉPENSES
// ============================================================
export function validateDepense(
  data: Partial<Depense>,
  _DB: Database
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Libellé obligatoire
  if (!data.libelle || data.libelle.trim() === "") {
    errors.push("Le libellé de la dépense est obligatoire.");
  }

  // Montant positif
  if (!data.montant || data.montant <= 0) {
    errors.push("Le montant doit être supérieur à 0.");
  }
  if (data.montant && data.montant > 50000000) {
    errors.push("Montant anormalement élevé (> 50 000 000 F). Vérifiez la saisie.");
  }

  // Catégorie obligatoire
  if (!data.categorie || data.categorie.trim() === "") {
    errors.push("La catégorie est obligatoire.");
  }

  // Date obligatoire
  if (!data.date) {
    errors.push("La date est obligatoire.");
  }

  // Fournisseur recommandé (justificatif)
  if (!data.fournisseur || data.fournisseur.trim() === "") {
    warnings.push("Aucun fournisseur/justificatif mentionné. Ajoutez un fournisseur pour la traçabilité.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// VALIDATION DES PRODUCTIONS
// ============================================================
export function validateProduction(
  data: Partial<Production>,
  _DB: Database
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Packs positifs
  if (!data.packs || data.packs <= 0) {
    errors.push("Le nombre de packs doit être supérieur à 0.");
  }
  if (data.packs && data.packs > 50000) {
    errors.push("Quantité anormale : plus de 50 000 packs. Vérifiez la saisie.");
  }

  // Date obligatoire
  if (!data.date) {
    errors.push("La date de production est obligatoire.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// VALIDATION DES RÉCEPTIONS ROULEAUX
// ============================================================
export function validateLivraison(
  data: Partial<Livraison>,
  _DB: Database
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Fournisseur obligatoire
  if (!data.fournisseur || data.fournisseur.trim() === "") {
    errors.push("Le fournisseur est obligatoire.");
  }

  // Kg positif
  if (!data.kg || data.kg <= 0) {
    errors.push("La quantité en kg doit être supérieure à 0.");
  }
  if (data.kg && data.kg > 100000) {
    errors.push("Quantité anormale : plus de 100 000 kg. Vérifiez la saisie.");
  }

  // Prix positif
  if (!data.prix || data.prix <= 0) {
    errors.push("Le prix total doit être supérieur à 0.");
  }

  // Date obligatoire
  if (!data.date) {
    errors.push("La date est obligatoire.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// VALIDATION DES MAINTENANCES
// ============================================================
export function validateMaintenance(
  data: Partial<Maintenance>,
  _DB: Database
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.equipement || data.equipement.trim() === "") {
    errors.push("L'équipement est obligatoire.");
  }
  if (!data.description || data.description.trim() === "") {
    errors.push("La description est obligatoire.");
  }
  if (!data.cout || data.cout <= 0) {
    errors.push("Le coût doit être supérieur à 0.");
  }
  if (data.cout && data.cout > 50000000) {
    errors.push("Coût anormalement élevé. Vérifiez la saisie.");
  }
  if (!data.date) {
    errors.push("La date est obligatoire.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// VALIDATION DES VERSEMENTS
// ============================================================
export function validateVersement(
  data: Partial<Versement>,
  _DB: Database
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.beneficiaire || data.beneficiaire.trim() === "") {
    errors.push("Le bénéficiaire est obligatoire.");
  }
  if (!data.montant || data.montant <= 0) {
    errors.push("Le montant doit être supérieur à 0.");
  }
  if (data.montant && data.montant > 100000000) {
    errors.push("Montant anormalement élevé. Vérifiez la saisie.");
  }
  if (!data.type || data.type.trim() === "") {
    errors.push("Le type de versement est obligatoire.");
  }
  if (!data.date) {
    errors.push("La date est obligatoire.");
  }

  return { valid: errors.length === 0, errors, warnings };
}
