/**
 * Exécution des demandes approuvées — MA2F AquaSachet
 *
 * Pont entre le module d'approbation (approvalWorkflow.ts) et l'action réelle
 * qu'une demande approuvée doit déclencher. N'exécute que les actions marquées
 * `executable: true` dans ACTIONS_DEMANDABLES (approvalWorkflow.ts) — les
 * autres continuent de nécessiter une intervention manuelle de l'admin après
 * approbation, comme avant.
 *
 * Important : chaque exécution est ponctuelle, sur l'enregistrement ciblé par
 * la demande. Elle ne modifie jamais les permissions du demandeur.
 */

import type { Database, Depense } from "./types";
import type { ApprovalRequest } from "./approvalWorkflow";
import { uid } from "./helpers";
import { checkCloture } from "./cloture";
import { creerMouvementAjustement, type ProduitType } from "./stock";
import { createHistoryEntry, addHistoryEntry, FIELD_LABELS } from "./history";

export interface ExecutionResult {
  db: Database;
  error?: string;
}

/**
 * Exécute réellement l'action d'une demande approuvée.
 * Retourne la DB inchangée + un message d'erreur si l'exécution est
 * impossible (cible supprimée entre-temps, clôture verrouillée, etc.) —
 * dans ce cas l'appelant NE DOIT PAS marquer la demande comme approuvée.
 */
export function executeApprovedRequest(
  request: ApprovalRequest,
  DB: Database,
  approbateurNom: string
): ExecutionResult {
  const details = request.details || {};

  switch (request.action) {
    case "suppression_vente": {
      const targetId = details.targetId;
      const item = DB.ventes.find((v) => v.id === targetId);
      if (!item) return { db: DB, error: "La vente ciblée n'existe plus (déjà supprimée ou modifiée)." };
      const clotureMsg = checkCloture(item.date, DB, "admin");
      if (clotureMsg) return { db: DB, error: clotureMsg };
      const corbeille = [
        ...DB.corbeille,
        {
          id: uid(),
          originalType: "ventes",
          moduleName: "Vente",
          desc: `${item.numero} - ${item.client}`,
          deletedAt: new Date().toISOString(),
          deletedBy: approbateurNom,
          data: item,
        },
      ];
      return { db: { ...DB, ventes: DB.ventes.filter((v) => v.id !== targetId), corbeille } };
    }

    case "suppression_client_solde": {
      const targetId = details.targetId;
      const item = DB.clients.find((c) => c.id === targetId);
      if (!item) return { db: DB, error: "Le client ciblé n'existe plus (déjà supprimé ou modifié)." };
      const corbeille = [
        ...DB.corbeille,
        {
          id: uid(),
          originalType: "clients",
          moduleName: "Client",
          desc: item.nom,
          deletedAt: new Date().toISOString(),
          deletedBy: approbateurNom,
          data: item,
        },
      ];
      return { db: { ...DB, clients: DB.clients.filter((c) => c.id !== targetId), corbeille } };
    }

    case "suppression_recouvrement": {
      const targetId = details.targetId;
      const item = DB.recouvrements.find((r) => r.id === targetId);
      if (!item) return { db: DB, error: "L'encaissement ciblé n'existe plus (déjà supprimé ou modifié)." };
      const clotureMsg = checkCloture(item.date, DB, "admin");
      if (clotureMsg) return { db: DB, error: clotureMsg };
      const corbeille = [
        ...DB.corbeille,
        {
          id: uid(),
          originalType: "recouvrements",
          moduleName: "Recouvrement",
          desc: `${item.numeroBL || "Sans BL"} - ${item.client} - ${item.montant.toLocaleString("fr-FR")} F`,
          deletedAt: new Date().toISOString(),
          deletedBy: approbateurNom,
          data: item,
        },
      ];
      return { db: { ...DB, recouvrements: DB.recouvrements.filter((r) => r.id !== targetId), corbeille } };
    }

    case "modification_recouvrement": {
      const targetId = details.targetId;
      const item = DB.recouvrements.find((r) => r.id === targetId);
      if (!item) return { db: DB, error: "L'encaissement ciblé n'existe plus (déjà supprimé ou modifié)." };
      const clotureMsg = checkCloture(item.date, DB, "admin");
      if (clotureMsg) return { db: DB, error: clotureMsg };

      const montant = details.montant !== undefined && details.montant !== "" ? Number(details.montant) : undefined;
      const mode = details.mode || undefined;
      const notes = details.notes;
      if (montant === undefined && mode === undefined && notes === undefined) {
        return { db: DB, error: "Aucune modification proposée dans la demande." };
      }
      if (montant !== undefined && (!Number.isFinite(montant) || montant <= 0)) {
        return { db: DB, error: "Montant proposé invalide." };
      }

      const updatedItem = {
        ...item,
        ...(montant !== undefined ? { montant } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
      return {
        db: {
          ...DB,
          recouvrements: DB.recouvrements.map((r) => (r.id === targetId ? updatedItem : r)),
        },
      };
    }

    case "ajustement_stock": {
      const produit = details.produit as ProduitType | undefined;
      const sens = details.sens as "entree" | "sortie" | undefined;
      const quantite = Number(details.quantite);
      if (!produit || !sens || !quantite || quantite <= 0) {
        return { db: DB, error: "Détails de l'ajustement de stock incomplets." };
      }
      const mvt = creerMouvementAjustement(
        uid(),
        new Date().toISOString().slice(0, 10),
        quantite,
        produit,
        "usine",
        sens,
        approbateurNom,
        request.description
      );
      return { db: { ...DB, mouvementsStock: [...(DB.mouvementsStock || []), mvt] } };
    }

    case "depense_elevee": {
      // Dépense créée par un non-admin au-delà de DB.params.seuilApprobationDepense
      // (voir DepensesSection.tsx) : les champs de la dépense voyagent dans
      // `details` (pas de targetId — rien n'existe encore, contrairement aux
      // autres actions ci-dessus qui agissent sur un enregistrement déjà
      // créé). L'approbation crée réellement la dépense, avec son entrée
      // d'historique, comme si elle avait été enregistrée directement.
      const { date, categorie, libelle, fournisseur, montant, employeId } = details;
      if (!date || !categorie || !libelle || !montant || Number(montant) <= 0) {
        return { db: DB, error: "Détails de la dépense incomplets ou invalides." };
      }
      const clotureMsg = checkCloture(date, DB, "admin");
      if (clotureMsg) return { db: DB, error: clotureMsg };
      const item: Depense = {
        id: uid(),
        date,
        categorie,
        libelle,
        fournisseur: fournisseur || "",
        montant: Number(montant),
        ...(employeId ? { employeId } : {}),
      };
      const histEntry = createHistoryEntry(
        "Dépenses",
        item.id,
        `${item.libelle} - ${item.montant.toLocaleString("fr-FR")} F`,
        item as any,
        approbateurNom,
        undefined,
        FIELD_LABELS
      );
      const updated = addHistoryEntry({ ...DB, depenses: [...DB.depenses, item] }, histEntry);
      return { db: updated };
    }

    default:
      // Action non auto-exécutable (executable: false dans le catalogue) :
      // rien à faire ici, l'admin applique le changement manuellement.
      return { db: DB };
  }
}
