/**
 * Module de Monitoring et Alertes — MA2F AquaSachet
 * 
 * Surveille en temps réel :
 * - Erreurs applicatives
 * - Écarts de caisse
 * - Accès suspects (tentatives multiples, heures inhabituelles)
 * - Performance des opérations
 * - Anomalies financières
 */

import type { Database } from "./types";
import { toLocalDateStr, todayLocal, daysBetween, addYears } from "@/lib/helpers";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertCategory = "security" | "finance" | "stock" | "performance" | "integrity" | "maintenance";

export interface Alert {
  id: string;
  timestamp: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  details?: Record<string, any>;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

export interface MonitoringConfig {
  // Seuils financiers
  seuilEcartCaisse: number;           // Écart caisse max toléré (F)
  seuilVenteAnormale: number;         // Montant vente anormalement élevé (F)
  seuilDepenseAnormale: number;       // Dépense anormalement élevée (F)
  
  // Seuils sécurité
  maxTentativesConnexion: number;     // Tentatives avant alerte
  heuresNormales: [number, number];   // Plage horaire normale [début, fin]
  
  // Seuils stock
  seuilStockBas: number;              // Stock minimum avant alerte (packs)
  seuilStockMPBas: number;            // Stock matière première minimum (kg)
  seuilEcartStockPacks: number;       // Écart comptage physique vs théorique toléré (packs)
  seuilEcartStockKg: number;          // Écart comptage physique vs théorique toléré (kg, matière première)
  
  // Seuils performance
  maxOperationsParMinute: number;     // Rate limiting
  maxTailleDB: number;               // Taille max de la DB locale (Mo)

  // Seuils maintenance
  seuilJoursAvantEcheanceMembrane: number; // Jours avant échéance membrane pour déclencher l'alerte
}

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  seuilEcartCaisse: 5000,
  seuilVenteAnormale: 2000000,
  seuilDepenseAnormale: 500000,
  maxTentativesConnexion: 5,
  heuresNormales: [6, 22],
  seuilStockBas: 50,
  seuilStockMPBas: 100,
  seuilEcartStockPacks: 20,
  seuilEcartStockKg: 15,
  maxOperationsParMinute: 60,
  maxTailleDB: 50,
  seuilJoursAvantEcheanceMembrane: 10,
};

// ─── Détection d'anomalies ───────────────────────────────────────────────────

/**
 * Analyse la base de données et génère des alertes
 */
export function analyzeForAlerts(DB: Database, config?: MonitoringConfig): Alert[] {
  const cfg = config || DEFAULT_MONITORING_CONFIG;
  const alerts: Alert[] = [];
  const now = new Date();

  // 1. ALERTES FINANCIÈRES
  
  // Vérifier les écarts de caisse dans les clôtures
  const clotures = DB.params.clotures || [];
  const cloturesAvecEcart = clotures.filter(
    (c) => c.ecartCaisse && Math.abs(c.ecartCaisse) > cfg.seuilEcartCaisse
  );
  for (const c of cloturesAvecEcart) {
    alerts.push({
      id: `alert_ecart_${c.date}`,
      timestamp: c.clotureeLe || c.date,
      severity: Math.abs(c.ecartCaisse || 0) > cfg.seuilEcartCaisse * 3 ? "critical" : "warning",
      category: "finance",
      title: "Écart de caisse significatif",
      message: `Écart de ${(c.ecartCaisse || 0).toLocaleString("fr-FR")} F détecté le ${c.date}`,
      details: { date: c.date, ecart: c.ecartCaisse, explication: c.explicationEcart },
      acknowledged: false,
    });
  }

  // Ventes anormalement élevées
  const ventesAnormales = DB.ventes.filter((v) => v.packs * v.prix > cfg.seuilVenteAnormale);
  for (const v of ventesAnormales) {
    alerts.push({
      id: `alert_vente_${v.id}`,
      timestamp: v.date,
      severity: "warning",
      category: "finance",
      title: "Vente anormalement élevée",
      message: `Vente de ${(v.packs * v.prix).toLocaleString("fr-FR")} F pour ${v.client}`,
      details: { venteId: v.id, client: v.client, montant: v.packs * v.prix },
      acknowledged: false,
    });
  }

  // Dépenses anormalement élevées
  const depensesAnormales = DB.depenses.filter((d) => d.montant > cfg.seuilDepenseAnormale);
  for (const d of depensesAnormales) {
    alerts.push({
      id: `alert_depense_${d.id}`,
      timestamp: d.date,
      severity: "warning",
      category: "finance",
      title: "Dépense anormalement élevée",
      message: `Dépense de ${d.montant.toLocaleString("fr-FR")} F — ${d.libelle}`,
      details: { depenseId: d.id, montant: d.montant, libelle: d.libelle },
      acknowledged: false,
    });
  }

  // 2. ALERTES STOCK

  // Stock produit fini bas
  const totalProduit = DB.production.reduce((s, p) => s + p.packs, 0);
  const totalVendu = DB.ventes.reduce((s, v) => s + v.packs + (v.bonus || 0), 0);
  const stockPF = totalProduit - totalVendu;
  
  if (stockPF < cfg.seuilStockBas) {
    alerts.push({
      id: `alert_stock_pf_${toLocalDateStr(now)}`,
      timestamp: now.toISOString(),
      severity: stockPF <= 0 ? "critical" : "warning",
      category: "stock",
      title: "Stock produit fini bas",
      message: `Stock PF: ${stockPF} packs (seuil: ${cfg.seuilStockBas})`,
      details: { stockActuel: stockPF, seuil: cfg.seuilStockBas },
      acknowledged: false,
    });
  }

  // Stock matière première bas
  const totalKgLivres = DB.livraisons.reduce((s, l) => s + l.kg, 0);
  const taux = DB.params.tauxSachetsParKg || 17;
  const kgConsommes = totalProduit / taux;
  const stockMP = totalKgLivres - kgConsommes;

  if (stockMP < cfg.seuilStockMPBas) {
    alerts.push({
      id: `alert_stock_mp_${toLocalDateStr(now)}`,
      timestamp: now.toISOString(),
      severity: stockMP <= 0 ? "critical" : "warning",
      category: "stock",
      title: "Stock matière première bas",
      message: `Stock MP: ${stockMP.toFixed(1)} kg (seuil: ${cfg.seuilStockMPBas} kg)`,
      details: { stockActuel: stockMP, seuil: cfg.seuilStockMPBas },
      acknowledged: false,
    });
  }

  // Écart de contrôle physique du stock usine (comptage vs théorique)
  // — signal de vol ou d'erreur de saisie non expliqué à haute valeur.
  const stockControles = (DB as any).stockControles || [];
  const dernierControlePlein = [...stockControles]
    .filter((c: any) => c.produit === "sachet_plein")
    .sort((a: any, b: any) => (b.compteLe || b.date).localeCompare(a.compteLe || a.date))[0];
  if (dernierControlePlein && Math.abs(dernierControlePlein.ecart) > cfg.seuilEcartStockPacks) {
    alerts.push({
      id: `alert_ecart_stock_${dernierControlePlein.id}`,
      timestamp: dernierControlePlein.compteLe || dernierControlePlein.date,
      severity: Math.abs(dernierControlePlein.ecart) > cfg.seuilEcartStockPacks * 3 ? "critical" : "warning",
      category: "stock",
      title: "Écart de stock usine significatif (sachets pleins)",
      message: `Écart de ${dernierControlePlein.ecart > 0 ? "+" : ""}${dernierControlePlein.ecart} packs lors du contrôle du ${dernierControlePlein.date}`,
      details: { date: dernierControlePlein.date, ecart: dernierControlePlein.ecart, explication: dernierControlePlein.explicationEcart },
      acknowledged: false,
    });
  }
  const dernierControleMP = [...stockControles]
    .filter((c: any) => c.produit === "rouleau_plastique")
    .sort((a: any, b: any) => (b.compteLe || b.date).localeCompare(a.compteLe || a.date))[0];
  if (dernierControleMP && Math.abs(dernierControleMP.ecart) > cfg.seuilEcartStockKg) {
    alerts.push({
      id: `alert_ecart_stock_${dernierControleMP.id}`,
      timestamp: dernierControleMP.compteLe || dernierControleMP.date,
      severity: Math.abs(dernierControleMP.ecart) > cfg.seuilEcartStockKg * 3 ? "critical" : "warning",
      category: "stock",
      title: "Écart de stock usine significatif (matière première)",
      message: `Écart de ${dernierControleMP.ecart > 0 ? "+" : ""}${dernierControleMP.ecart} kg lors du contrôle du ${dernierControleMP.date}`,
      details: { date: dernierControleMP.date, ecart: dernierControleMP.ecart, explication: dernierControleMP.explicationEcart },
      acknowledged: false,
    });
  }

  // 3. ALERTES INTÉGRITÉ

  // Doublons d'IDs
  const venteIds = DB.ventes.map((v) => v.id);
  const doublons = venteIds.filter((id, i) => venteIds.indexOf(id) !== i);
  if (doublons.length > 0) {
    alerts.push({
      id: `alert_doublons_${now.toISOString()}`,
      timestamp: now.toISOString(),
      severity: "critical",
      category: "integrity",
      title: "Doublons d'identifiants détectés",
      message: `${doublons.length} doublon(s) dans les ventes`,
      details: { doublons },
      acknowledged: false,
    });
  }

  // Montants négatifs
  const montantsNegatifs = [
    ...DB.ventes.filter((v) => v.packs < 0 || v.prix < 0).map((v) => ({ type: "vente", id: v.id })),
    ...DB.depenses.filter((d) => d.montant < 0).map((d) => ({ type: "depense", id: d.id })),
  ];
  if (montantsNegatifs.length > 0) {
    alerts.push({
      id: `alert_negatifs_${now.toISOString()}`,
      timestamp: now.toISOString(),
      severity: "critical",
      category: "integrity",
      title: "Montants négatifs détectés",
      message: `${montantsNegatifs.length} enregistrement(s) avec montant négatif`,
      details: { items: montantsNegatifs },
      acknowledged: false,
    });
  }

  // 4. ALERTES SÉCURITÉ — Accès hors heures normales
  const heure = now.getHours();
  if (heure < cfg.heuresNormales[0] || heure > cfg.heuresNormales[1]) {
    alerts.push({
      id: `alert_horaire_${now.toISOString()}`,
      timestamp: now.toISOString(),
      severity: "info",
      category: "security",
      title: "Accès hors heures normales",
      message: `Connexion détectée à ${heure}h (plage normale: ${cfg.heuresNormales[0]}h-${cfg.heuresNormales[1]}h)`,
      details: { heure, plageNormale: cfg.heuresNormales },
      acknowledged: false,
    });
  }

  // 5. ALERTES MAINTENANCE

  // Échéance de changement de membrane. Une membrane a une durée de vie
  // standard d'1 an (voir MaintenanceSection : la prochaine échéance est
  // pré-remplie automatiquement à date + 1 an dès que l'équipement contient
  // "membrane"). Si le champ `prochaine` n'a jamais été renseigné (ex:
  // intervention créée avant l'auto-remplissage, jamais rouverte en édition
  // depuis), on retombe sur date + 1 an calculée à la volée — l'alerte doit
  // sortir même sans modification manuelle de l'entrée. On ne regarde que la
  // DERNIÈRE intervention "membrane" par nom d'équipement — dès qu'une
  // nouvelle membrane est posée, elle devient la référence et l'alerte sur
  // l'ancienne échéance disparaît d'elle-même. L'alerte démarre
  // `seuilJoursAvantEcheanceMembrane` jours avant l'échéance et reste
  // active (elle devient critique) tant que la membrane n'a pas été
  // changée, même après la date dépassée.
  const echeanceMembrane = (m: (typeof DB.maintenance)[number]) => m.prochaine || addYears(m.date, 1);
  const dernieresMembranesParEquipement = new Map<string, (typeof DB.maintenance)[number]>();
  for (const m of DB.maintenance) {
    if (!/membrane/i.test(m.equipement)) continue;
    const cle = m.equipement.trim().toLowerCase();
    const courant = dernieresMembranesParEquipement.get(cle);
    if (!courant || m.date > courant.date) dernieresMembranesParEquipement.set(cle, m);
  }
  const today = todayLocal();
  for (const m of Array.from(dernieresMembranesParEquipement.values())) {
    const echeance = echeanceMembrane(m);
    if (!echeance) continue;
    const jours = daysBetween(today, echeance);
    if (jours > cfg.seuilJoursAvantEcheanceMembrane) continue;
    const enRetard = jours < 0;
    alerts.push({
      id: `alert_membrane_${m.id}`,
      timestamp: now.toISOString(),
      severity: enRetard ? "critical" : "warning",
      category: "maintenance",
      title: enRetard ? "Changement de membrane en retard" : "Changement de membrane à prévoir",
      message: enRetard
        ? `La membrane "${m.equipement}" devait être changée le ${echeance} (en retard de ${Math.abs(jours)} jour${Math.abs(jours) > 1 ? "s" : ""})`
        : `La membrane "${m.equipement}" doit être changée le ${echeance} (dans ${jours} jour${jours > 1 ? "s" : ""})`,
      details: { maintenanceId: m.id, equipement: m.equipement, echeance, jours },
      acknowledged: false,
    });
  }

  return alerts.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface RateLimitEntry {
  timestamp: number;
  action: string;
}

const rateLimitStore: RateLimitEntry[] = [];

/**
 * Vérifie si une action est autorisée selon le rate limiting
 */
export function checkRateLimit(
  action: string,
  maxPerMinute: number = DEFAULT_MONITORING_CONFIG.maxOperationsParMinute
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  // Nettoyer les entrées expirées
  while (rateLimitStore.length > 0 && rateLimitStore[0].timestamp < oneMinuteAgo) {
    rateLimitStore.shift();
  }

  // Compter les actions dans la dernière minute
  const recentActions = rateLimitStore.filter(
    (e) => e.action === action && e.timestamp >= oneMinuteAgo
  );

  if (recentActions.length >= maxPerMinute) {
    const oldestInWindow = recentActions[0].timestamp;
    const resetIn = Math.ceil((oldestInWindow + 60000 - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  // Enregistrer l'action
  rateLimitStore.push({ timestamp: now, action });

  return {
    allowed: true,
    remaining: maxPerMinute - recentActions.length - 1,
    resetIn: 0,
  };
}

// ─── Détection de conflits (Optimistic Locking) ─────────────────────────────

export interface ConflictInfo {
  entityType: string;
  entityId: string;
  localVersion: number;
  remoteVersion: number;
  localChanges: Record<string, any>;
  remoteChanges: Record<string, any>;
  timestamp: string;
}

/**
 * Vérifie s'il y a un conflit de version entre la version locale et distante
 */
export function detectConflict(
  localVersion: number,
  remoteVersion: number,
  entityType: string,
  entityId: string,
  localData: Record<string, any>,
  remoteData: Record<string, any>
): ConflictInfo | null {
  if (remoteVersion > localVersion) {
    return {
      entityType,
      entityId,
      localVersion,
      remoteVersion,
      localChanges: localData,
      remoteChanges: remoteData,
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

/**
 * Stratégies de résolution de conflits
 */
export type ConflictResolution = "local_wins" | "remote_wins" | "merge" | "manual";

export function resolveConflict(
  conflict: ConflictInfo,
  strategy: ConflictResolution,
  manualResolution?: Record<string, any>
): Record<string, any> {
  switch (strategy) {
    case "local_wins":
      return conflict.localChanges;
    case "remote_wins":
      return conflict.remoteChanges;
    case "merge":
      // Merge simple : les champs modifiés localement prennent priorité
      return { ...conflict.remoteChanges, ...conflict.localChanges };
    case "manual":
      return manualResolution || conflict.remoteChanges;
    default:
      return conflict.remoteChanges;
  }
}

// ─── Performance Metrics ─────────────────────────────────────────────────────

interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  success: boolean;
}

const performanceLog: PerformanceMetric[] = [];

/**
 * Mesure la durée d'une opération
 */
export function measurePerformance<T>(
  operation: string,
  fn: () => T
): T {
  const start = performance.now();
  try {
    const result = fn();
    const duration = performance.now() - start;
    performanceLog.push({ operation, duration, timestamp: Date.now(), success: true });
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    performanceLog.push({ operation, duration, timestamp: Date.now(), success: false });
    throw error;
  }
}

/**
 * Obtient les métriques de performance récentes
 */
export function getPerformanceMetrics(lastMinutes: number = 5) {
  const cutoff = Date.now() - lastMinutes * 60000;
  const recent = performanceLog.filter((m) => m.timestamp >= cutoff);
  
  if (recent.length === 0) {
    return { avgDuration: 0, maxDuration: 0, errorRate: 0, totalOps: 0 };
  }

  const avgDuration = recent.reduce((s, m) => s + m.duration, 0) / recent.length;
  const maxDuration = Math.max(...recent.map((m) => m.duration));
  const errors = recent.filter((m) => !m.success).length;
  const errorRate = (errors / recent.length) * 100;

  return { avgDuration, maxDuration, errorRate, totalOps: recent.length };
}
