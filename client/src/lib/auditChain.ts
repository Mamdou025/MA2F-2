/**
 * Module de signatures numériques chaînées — MA2F AquaSachet
 * 
 * Chaque entrée d'audit est liée à la précédente par un hash SHA-256.
 * Si une entrée est modifiée ou supprimée, la chaîne est rompue et l'intégrité est compromise.
 * 
 * Principe : hash(n) = SHA-256( hash(n-1) + action + module + entityId + userId + timestamp + details )
 * Le premier bloc utilise un hash genesis fixe.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  sequence: number;
  action: string;
  module: string;
  entityId: string;
  userId: string;
  userEmail: string;
  userRole: string;
  details: string;
  timestamp: string;
  previousHash: string;
  hash: string;
  signature: string;
}

export interface ChainValidationResult {
  valid: boolean;
  totalEntries: number;
  brokenAt?: number;
  brokenEntry?: AuditEntry;
  message: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const APP_SECRET_PREFIX = "MA2F_AUDIT_v2_";

// ─── Fonctions de hachage ────────────────────────────────────────────────────

/**
 * Calcule le hash SHA-256 d'une chaîne de caractères
 * Utilise l'API Web Crypto (disponible dans tous les navigateurs modernes)
 */
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Calcule le hash SHA-256 de manière synchrone (fallback pour les environnements sans Web Crypto)
 * Utilise un algorithme simplifié pour les cas où crypto.subtle n'est pas disponible
 */
function sha256Sync(message: string): string {
  // Implémentation simple de hash pour fallback (non cryptographique, mais suffisant pour la détection d'altération)
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Étendre à 64 caractères hex pour compatibilité
  const base = Math.abs(hash).toString(16).padStart(8, "0");
  return (base + base + base + base + base + base + base + base).slice(0, 64);
}

// ─── Création d'entrées ──────────────────────────────────────────────────────

/**
 * Construit la chaîne à hasher pour une entrée d'audit
 */
function buildHashInput(entry: {
  previousHash: string;
  action: string;
  module: string;
  entityId: string;
  userId: string;
  timestamp: string;
  details: string;
}): string {
  return [
    APP_SECRET_PREFIX,
    entry.previousHash,
    entry.action,
    entry.module,
    entry.entityId,
    entry.userId,
    entry.timestamp,
    entry.details,
  ].join("|");
}

/**
 * Crée une nouvelle entrée d'audit chaînée
 */
export async function createAuditEntry(params: {
  sequence: number;
  action: string;
  module: string;
  entityId: string;
  userId: string;
  userEmail: string;
  userRole: string;
  details: string;
  previousHash?: string;
}): Promise<AuditEntry> {
  const timestamp = new Date().toISOString();
  const previousHash = params.previousHash || GENESIS_HASH;

  const hashInput = buildHashInput({
    previousHash,
    action: params.action,
    module: params.module,
    entityId: params.entityId,
    userId: params.userId,
    timestamp,
    details: params.details,
  });

  let hash: string;
  try {
    hash = await sha256(hashInput);
  } catch {
    hash = sha256Sync(hashInput);
  }

  // Signature = hash du hash + sequence (double protection)
  let signature: string;
  try {
    signature = await sha256(`${APP_SECRET_PREFIX}${hash}${params.sequence}`);
  } catch {
    signature = sha256Sync(`${APP_SECRET_PREFIX}${hash}${params.sequence}`);
  }

  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sequence: params.sequence,
    action: params.action,
    module: params.module,
    entityId: params.entityId,
    userId: params.userId,
    userEmail: params.userEmail,
    userRole: params.userRole,
    details: params.details,
    timestamp,
    previousHash,
    hash,
    signature,
  };
}

// ─── Validation de la chaîne ─────────────────────────────────────────────────

/**
 * Vérifie l'intégrité complète de la chaîne d'audit
 * Retourne le premier point de rupture s'il y en a un
 */
export async function validateAuditChain(entries: AuditEntry[]): Promise<ChainValidationResult> {
  if (entries.length === 0) {
    return { valid: true, totalEntries: 0, message: "Chaîne vide — aucune entrée à vérifier." };
  }

  // Trier par séquence
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const expectedPreviousHash = i === 0 ? GENESIS_HASH : sorted[i - 1].hash;

    // Vérifier le chaînage
    if (entry.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        totalEntries: sorted.length,
        brokenAt: i,
        brokenEntry: entry,
        message: `Chaîne rompue à l'entrée #${entry.sequence}: le hash précédent ne correspond pas. Possible altération ou suppression.`,
      };
    }

    // Recalculer le hash pour vérifier l'intégrité du contenu
    const hashInput = buildHashInput({
      previousHash: entry.previousHash,
      action: entry.action,
      module: entry.module,
      entityId: entry.entityId,
      userId: entry.userId,
      timestamp: entry.timestamp,
      details: entry.details,
    });

    let expectedHash: string;
    try {
      expectedHash = await sha256(hashInput);
    } catch {
      expectedHash = sha256Sync(hashInput);
    }

    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        totalEntries: sorted.length,
        brokenAt: i,
        brokenEntry: entry,
        message: `Entrée #${entry.sequence} altérée: le contenu a été modifié après enregistrement.`,
      };
    }

    // Vérifier la signature
    let expectedSignature: string;
    try {
      expectedSignature = await sha256(`${APP_SECRET_PREFIX}${entry.hash}${entry.sequence}`);
    } catch {
      expectedSignature = sha256Sync(`${APP_SECRET_PREFIX}${entry.hash}${entry.sequence}`);
    }

    if (entry.signature !== expectedSignature) {
      return {
        valid: false,
        totalEntries: sorted.length,
        brokenAt: i,
        brokenEntry: entry,
        message: `Signature invalide à l'entrée #${entry.sequence}: possible falsification.`,
      };
    }
  }

  return {
    valid: true,
    totalEntries: sorted.length,
    message: `Chaîne intègre — ${sorted.length} entrées vérifiées sans anomalie.`,
  };
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Obtient le dernier hash de la chaîne (pour créer la prochaine entrée)
 */
export function getLastHash(entries: AuditEntry[]): string {
  if (entries.length === 0) return GENESIS_HASH;
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  return sorted[sorted.length - 1].hash;
}

/**
 * Obtient le prochain numéro de séquence
 */
export function getNextSequence(entries: AuditEntry[]): number {
  if (entries.length === 0) return 1;
  return Math.max(...entries.map((e) => e.sequence)) + 1;
}

/**
 * Génère un rapport de vérification d'intégrité formaté
 */
export function formatValidationReport(result: ChainValidationResult): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════");
  lines.push("  RAPPORT DE VÉRIFICATION D'INTÉGRITÉ DE LA CHAÎNE D'AUDIT");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Statut: ${result.valid ? "✓ INTÈGRE" : "✗ COMPROMISE"}`);
  lines.push(`Entrées vérifiées: ${result.totalEntries}`);
  lines.push(`Résultat: ${result.message}`);

  if (!result.valid && result.brokenEntry) {
    lines.push("");
    lines.push("─── Détails de la rupture ───");
    lines.push(`Position: entrée #${result.brokenAt}`);
    lines.push(`Séquence: ${result.brokenEntry.sequence}`);
    lines.push(`Action: ${result.brokenEntry.action}`);
    lines.push(`Module: ${result.brokenEntry.module}`);
    lines.push(`Utilisateur: ${result.brokenEntry.userEmail}`);
    lines.push(`Date: ${result.brokenEntry.timestamp}`);
  }

  lines.push("");
  lines.push(`Vérifié le: ${new Date().toISOString()}`);
  lines.push("═══════════════════════════════════════════════════");

  return lines.join("\n");
}
