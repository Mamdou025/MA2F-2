/**
 * Module Cloud Functions — MA2F AquaSachet
 * 
 * Centralise tous les appels aux Cloud Functions Firebase.
 * Chaque opération sensible passe par le serveur au lieu d'écrire directement dans Firestore.
 * 
 * Si les Cloud Functions ne sont pas déployées, les appels échouent gracieusement
 * et l'application bascule en mode "client direct" (fallback).
 */

import { functions, httpsCallable } from "./firebase";

// ─── Types de réponse ─────────────────────────────────────────────────────────

export interface CloudFunctionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  fallback?: boolean; // true si le mode fallback client a été utilisé
}

// ─── Flag de disponibilité ────────────────────────────────────────────────────

let cloudFunctionsAvailable: boolean | null = null;

/**
 * Vérifie si les Cloud Functions sont déployées et accessibles.
 * Met en cache le résultat pour éviter des appels répétés.
 */
export async function checkCloudFunctionsAvailability(): Promise<boolean> {
  if (cloudFunctionsAvailable !== null) return cloudFunctionsAvailable;

  try {
    const healthCheck = httpsCallable(functions, "healthCheck");
    await healthCheck({});
    cloudFunctionsAvailable = true;
  } catch (e: any) {
    // Si la fonction n'existe pas ou timeout, les CF ne sont pas déployées
    if (
      e.code === "functions/not-found" ||
      e.code === "functions/unavailable" ||
      e.code === "functions/deadline-exceeded" ||
      e.message?.includes("not found") ||
      e.message?.includes("CORS")
    ) {
      cloudFunctionsAvailable = false;
    } else {
      // Autre erreur (réseau, etc.) — on considère disponible
      cloudFunctionsAvailable = true;
    }
  }

  return cloudFunctionsAvailable;
}

/**
 * Réinitialise le cache de disponibilité (utile après un déploiement)
 */
export function resetCloudFunctionsCache(): void {
  cloudFunctionsAvailable = null;
}

// ─── Appels Cloud Functions ───────────────────────────────────────────────────

/**
 * Créer un utilisateur avec rôle (custom claims)
 */
export async function cfCreateUserWithRole(data: {
  email: string;
  displayName: string;
  role: string;
  roles: string[];
  tel?: string;
}): Promise<CloudFunctionResult<{ uid: string; resetLink: string }>> {
  try {
    const fn = httpsCallable(functions, "createUserWithRole");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur création utilisateur" };
  }
}

/**
 * Mettre à jour les custom claims d'un utilisateur
 */
export async function cfSetUserClaims(data: {
  uid?: string;
  email?: string;
  role: string;
  roles: string[];
}): Promise<CloudFunctionResult<{ uid: string }>> {
  try {
    const fn = httpsCallable(functions, "setUserClaims");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur mise à jour rôle" };
  }
}

/**
 * Activer/désactiver un utilisateur
 */
export async function cfToggleUserStatus(data: {
  uid: string;
  disabled: boolean;
}): Promise<CloudFunctionResult> {
  try {
    const fn = httpsCallable(functions, "toggleUserStatus");
    const result = await fn(data);
    return { success: true, data: result.data };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur changement statut" };
  }
}

/**
 * Valider et enregistrer une vente côté serveur
 */
export async function cfValidateVente(data: {
  clientId: string;
  clientNom: string;
  packs: number;
  prix: number;
  mode: string;
  avance?: number;
  commercial?: string;
  date: string;
  notes?: string;
}): Promise<CloudFunctionResult<{ venteId: string; commission: number; bonus: boolean }>> {
  try {
    const fn = httpsCallable(functions, "validateVente");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur validation vente" };
  }
}

/**
 * Valider et enregistrer un paiement/recouvrement côté serveur
 */
export async function cfValidatePaiement(data: {
  venteId: string;
  clientId: string;
  montant: number;
  mode: string;
  date: string;
  notes?: string;
}): Promise<CloudFunctionResult<{ recouvrementId: string; resteAPayer: number }>> {
  try {
    const fn = httpsCallable(functions, "validatePaiement");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur validation paiement" };
  }
}

/**
 * Clôturer la caisse côté serveur
 */
export async function cfCloturerCaisse(data: {
  date: string;
  montantCompte: number;
  explicationEcart?: string;
}): Promise<CloudFunctionResult<{ soldeAttendu: number; ecart: number }>> {
  try {
    const fn = httpsCallable(functions, "cloturerCaisse");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur clôture caisse" };
  }
}

/**
 * Vérification d'intégrité des données côté serveur
 */
export async function cfIntegrityCheck(): Promise<CloudFunctionResult<{
  stockCoherent: boolean;
  caisseCoherente: boolean;
  creancesCoherentes: boolean;
  details: string[];
}>> {
  try {
    const fn = httpsCallable(functions, "integrityCheck");
    const result = await fn({});
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur vérification intégrité" };
  }
}

/**
 * Ré-authentification de l'utilisateur (remplace le code admin hardcodé)
 */
export async function cfReauthenticate(data: {
  action: string;
  targetId?: string;
}): Promise<CloudFunctionResult<{ token: string; expiresAt: string }>> {
  try {
    const fn = httpsCallable(functions, "reauthenticate");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur ré-authentification" };
  }
}

/**
 * Générer un lien de paiement Wave (Checkout API) pour un client — utilisé
 * par Recouvrement pour encaisser une créance en ligne plutôt qu'en espèces.
 * Contrairement aux autres opérations, il n'existe volontairement PAS de
 * fallback client-side pour cette fonction : générer une session de paiement
 * nécessite la clé API Wave, qui ne doit jamais être exposée au navigateur.
 * Si les Cloud Functions sont indisponibles, le paiement mobile money n'est
 * simplement pas proposé (l'encaissement manuel classique reste disponible).
 */
export async function cfCreateWaveCheckoutSession(data: {
  venteId?: string;
  clientId?: string;
  clientNom: string;
  montant: number;
}): Promise<CloudFunctionResult<{ intentId: string; checkoutUrl: string }>> {
  try {
    const fn = httpsCallable(functions, "createWaveCheckoutSession");
    const result = await fn(data);
    return { success: true, data: result.data as any };
  } catch (e: any) {
    return { success: false, error: e.message || "Erreur création du lien de paiement Wave" };
  }
}

/**
 * Wrapper générique pour appeler une Cloud Function avec fallback
 * Si les CF ne sont pas déployées, retourne { success: false, fallback: true }
 */
export async function callCloudFunction<T = any>(
  functionName: string,
  data: any
): Promise<CloudFunctionResult<T>> {
  const available = await checkCloudFunctionsAvailability();

  if (!available) {
    return {
      success: false,
      fallback: true,
      error: "Cloud Functions non déployées. Mode client direct actif.",
    };
  }

  try {
    const fn = httpsCallable(functions, functionName);
    const result = await fn(data);
    return { success: true, data: result.data as T };
  } catch (e: any) {
    return { success: false, error: e.message || `Erreur appel ${functionName}` };
  }
}
