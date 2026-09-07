/**
 * Module de Séparation des Pouvoirs — MA2F AquaSachet
 * 
 * Principe : Aucune action critique ne peut être exécutée par un seul utilisateur.
 * Les actions sensibles nécessitent une double validation (maker/checker).
 * 
 * Flux :
 * 1. L'initiateur (maker) crée une demande d'approbation
 * 2. Un approbateur autorisé (checker) valide ou rejette
 * 3. L'action n'est exécutée qu'après approbation
 * 
 * Actions nécessitant double validation :
 * - Vente à crédit > seuil configurable
 * - Suppression d'un client avec solde
 * - Modification d'une écriture clôturée
 * - Annulation d'une clôture journalière
 * - Modification des paramètres financiers
 * - Création/modification des rôles utilisateurs
 * - Ajustement de stock (hors production/vente)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ActionCritiqueConnue =
  | "vente_credit_elevee"
  | "suppression_client_solde"
  | "modification_post_cloture"
  | "annulation_cloture"
  | "modification_parametres"
  | "modification_roles"
  | "ajustement_stock"
  | "suppression_vente"
  | "remise_exceptionnelle"
  | "versement_eleve"
  | "depense_elevee";

// Une action peut être l'une des actions critiques connues (déclenchées
// automatiquement par seuil) OU une clé libre du catalogue ACTIONS_DEMANDABLES
// (demande manuelle d'un utilisateur pour une action normalement réservée à
// l'admin). On garde le type large pour ne pas casser les demandes générées
// dynamiquement à partir du catalogue.
export type ActionCritique = ActionCritiqueConnue | string;

export interface ApprovalRequest {
  id: string;
  action: ActionCritique;
  module: string;
  description: string;
  details: Record<string, any>;
  montant?: number;
  initiateur: {
    userId: string;
    email: string;
    role: string;
    nom: string;
  };
  approbateur?: {
    userId: string;
    email: string;
    role: string;
    nom: string;
  };
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  motifRejet?: string;
  expiresAt: string;
}

export interface ApprovalConfig {
  seuilVenteCredit: number;      // Montant au-delà duquel une vente à crédit nécessite approbation
  seuilVersement: number;        // Montant au-delà duquel un versement nécessite approbation
  seuilRemise: number;           // Pourcentage de remise au-delà duquel une approbation est requise
  delaiExpiration: number;       // Heures avant expiration d'une demande
  rolesApprobateurs: string[];   // Rôles autorisés à approuver
  // Montant au-delà duquel une dépense nécessite approbation — absent de
  // DEFAULT_APPROVAL_CONFIG ci-dessous (contrairement aux seuils vente/
  // versement) car ce seuil est spécifique à MA2F et vient de
  // DB.params.seuilApprobationDepense (configurable dans Paramètres) :
  // undefined = pas de seuil configuré = fonctionnalité désactivée, pour ne
  // pas gater silencieusement un comportement existant tant qu'un admin n'a
  // pas explicitement choisi un montant. Voir DepensesSection.tsx.
  seuilDepense?: number;
}

// ─── Configuration par défaut ────────────────────────────────────────────────

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  seuilVenteCredit: 500000,      // 500 000 F
  seuilVersement: 1000000,       // 1 000 000 F
  seuilRemise: 10,               // 10%
  delaiExpiration: 24,           // 24 heures
  // "directeur" n'existe pas comme rôle de connexion dans l'app (rôles
  // réels : admin, caissier, commercial, lecteur) — seul admin approuve.
  rolesApprobateurs: ["admin"],
};

// ─── Catalogue des actions "demandables" ─────────────────────────────────────
// Actions normalement réservées à l'admin (invisibles ou non exécutables pour
// les autres rôles) qu'un utilisateur peut désormais demander via ce module.
// Sert à générer le formulaire "Nouvelle demande" et à filtrer les options
// selon le rôle du demandeur.

export interface ActionDemandable {
  label: string;
  section: string; // clé de Section (client/src/lib/types.ts) concernée
  roles: string[]; // rôles autorisés à soumettre cette demande
  // Si true, l'approbation exécute réellement l'action (voir approvalExecution.ts).
  // Si false, l'approbation ne fait que changer le statut ; l'admin doit encore
  // appliquer le changement lui-même ailleurs dans l'app (comportement d'origine).
  executable: boolean;
  // Type de cible à faire sélectionner dans le formulaire "Nouvelle demande",
  // uniquement pertinent quand executable === true.
  cible?: "vente" | "client" | "ajustement_stock" | "recouvrement" | "recouvrement_modif";
}

// NB: pas d'action "demander l'accès à une section" ici — approuver une
// demande dans ce module exécute une action ponctuelle, une seule fois, sur
// un enregistrement précis ; ça ne doit jamais modifier les permissions
// durables d'un utilisateur (ROLE_SECTIONS / allowedSections). L'octroi
// d'accès à une section reste une action manuelle de l'admin dans Utilisateurs.
export const ACTIONS_DEMANDABLES: Record<string, ActionDemandable> = {
  suppression_vente: { label: "Supprimer une vente", section: "ventes", roles: ["caissier", "commercial"], executable: true, cible: "vente" },
  suppression_client_solde: { label: "Supprimer un client avec solde", section: "clients", roles: ["caissier", "commercial"], executable: true, cible: "client" },
  suppression_recouvrement: { label: "Supprimer un encaissement/recouvrement", section: "recouvrement", roles: ["caissier", "commercial"], executable: true, cible: "recouvrement" },
  modification_recouvrement: { label: "Modifier un encaissement/recouvrement", section: "recouvrement", roles: ["caissier", "commercial"], executable: true, cible: "recouvrement_modif" },
  ajustement_stock: { label: "Ajuster le stock (hors production/vente)", section: "stock", roles: ["caissier"], executable: true, cible: "ajustement_stock" },
  modification_post_cloture: { label: "Modifier une écriture après clôture", section: "cloture", roles: ["caissier", "commercial"], executable: false },
  annulation_cloture: { label: "Annuler une clôture journalière", section: "cloture", roles: ["caissier"], executable: false },
  remise_exceptionnelle: { label: "Accorder une remise exceptionnelle", section: "ventes", roles: ["commercial"], executable: false },
  modification_parametres: { label: "Modifier un paramètre financier", section: "parametres", roles: ["caissier"], executable: false },
};

/**
 * Liste les actions qu'un rôle donné a le droit de demander.
 */
export function getRequestableActionsForRole(role: string): Array<{ key: string } & ActionDemandable> {
  return Object.entries(ACTIONS_DEMANDABLES)
    .filter(([, def]) => def.roles.includes(role))
    .map(([key, def]) => ({ key, ...def }));
}

/**
 * Un utilisateur ne peut pas soumettre une demande pour une action que son
 * rôle n'est pas censé pouvoir demander (garde-fou côté UI ; l'application
 * stricte reste côté règles Firestore / futur backend).
 */
export function canRequestAction(actionKey: string, role: string): boolean {
  const def = ACTIONS_DEMANDABLES[actionKey];
  return !!def && def.roles.includes(role);
}

// ─── Règles de validation ────────────────────────────────────────────────────

/**
 * Vérifie si une action nécessite une approbation
 */
export function requiresApproval(
  action: ActionCritique,
  params: { montant?: number; role?: string; config?: ApprovalConfig }
): boolean {
  const config = params.config || DEFAULT_APPROVAL_CONFIG;

  switch (action) {
    case "vente_credit_elevee":
      return (params.montant || 0) > config.seuilVenteCredit;

    case "versement_eleve":
      return (params.montant || 0) > config.seuilVersement;

    case "depense_elevee":
      return !!config.seuilDepense && (params.montant || 0) > config.seuilDepense;

    case "remise_exceptionnelle":
      return true; // Toujours requise

    case "suppression_client_solde":
    case "modification_post_cloture":
    case "annulation_cloture":
    case "modification_parametres":
    case "modification_roles":
    case "ajustement_stock":
    case "suppression_vente":
      return true; // Toujours requise pour ces actions

    default:
      return false;
  }
}

/**
 * Vérifie si un utilisateur peut approuver une demande
 * Règle : l'approbateur ne peut pas être l'initiateur (séparation des pouvoirs)
 */
export function canApprove(
  request: ApprovalRequest,
  userId: string,
  userRole: string,
  config?: ApprovalConfig
): boolean {
  const cfg = config || DEFAULT_APPROVAL_CONFIG;

  // L'initiateur ne peut pas approuver sa propre demande
  if (request.initiateur.userId === userId) return false;

  // Seuls les rôles autorisés peuvent approuver
  if (!cfg.rolesApprobateurs.includes(userRole)) return false;

  // La demande doit être en attente
  if (request.status !== "pending") return false;

  // Vérifier l'expiration
  if (new Date(request.expiresAt) < new Date()) return false;

  return true;
}

// ─── Création de demandes ────────────────────────────────────────────────────

/**
 * Crée une nouvelle demande d'approbation
 */
export function createApprovalRequest(params: {
  action: ActionCritique;
  module: string;
  description: string;
  details: Record<string, any>;
  montant?: number;
  initiateur: { userId: string; email: string; role: string; nom: string };
  config?: ApprovalConfig;
}): ApprovalRequest {
  const config = params.config || DEFAULT_APPROVAL_CONFIG;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.delaiExpiration * 60 * 60 * 1000);

  return {
    id: `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action: params.action,
    module: params.module,
    description: params.description,
    details: params.details,
    montant: params.montant,
    initiateur: params.initiateur,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Approuve une demande
 */
export function approveRequest(
  request: ApprovalRequest,
  approbateur: { userId: string; email: string; role: string; nom: string }
): ApprovalRequest {
  return {
    ...request,
    status: "approved",
    approbateur,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Rejette une demande
 */
export function rejectRequest(
  request: ApprovalRequest,
  approbateur: { userId: string; email: string; role: string; nom: string },
  motif: string
): ApprovalRequest {
  return {
    ...request,
    status: "rejected",
    approbateur,
    resolvedAt: new Date().toISOString(),
    motifRejet: motif,
  };
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Filtre les demandes en attente pour un approbateur donné
 */
export function getPendingForApprover(
  requests: ApprovalRequest[],
  userId: string,
  userRole: string,
  config?: ApprovalConfig
): ApprovalRequest[] {
  return requests.filter((r) => canApprove(r, userId, userRole, config));
}

/**
 * Vérifie si des demandes ont expiré et les marque comme telles
 */
export function expireOldRequests(requests: ApprovalRequest[]): ApprovalRequest[] {
  const now = new Date();
  return requests.map((r) => {
    if (r.status === "pending" && new Date(r.expiresAt) < now) {
      return { ...r, status: "expired" as ApprovalStatus };
    }
    return r;
  });
}

/**
 * Obtient le libellé français d'une action critique
 */
export function getActionLabel(action: ActionCritique): string {
  const labels: Record<ActionCritiqueConnue, string> = {
    vente_credit_elevee: "Vente à crédit élevée",
    suppression_client_solde: "Suppression client avec solde",
    modification_post_cloture: "Modification après clôture",
    annulation_cloture: "Annulation de clôture",
    modification_parametres: "Modification des paramètres",
    modification_roles: "Modification des rôles",
    ajustement_stock: "Ajustement de stock",
    suppression_vente: "Suppression d'une vente",
    remise_exceptionnelle: "Remise exceptionnelle",
    versement_eleve: "Versement élevé",
    depense_elevee: "Dépense élevée",
  };
  return (labels as Record<string, string>)[action] || ACTIONS_DEMANDABLES[action]?.label || action;
}

/**
 * Obtient les statistiques des demandes
 */
export function getApprovalStats(requests: ApprovalRequest[]) {
  return {
    total: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    expired: requests.filter((r) => r.status === "expired").length,
  };
}
