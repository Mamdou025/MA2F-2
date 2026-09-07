/**
 * Stockage local sécurisé avec chiffrement AES-GCM
 * Les données ne sont plus stockées en clair dans localStorage
 */

const STORAGE_KEY = "qprost_db_enc";
const CRYPTO_KEY_NAME = "ma2f_storage_key";
const KEYS_DB_NAME = "ma2f_keys";

// Anciennes clés localStorage utilisées avant/pendant la migration vers le
// chiffrement AES-GCM. "qprost_db" était le tout premier format en clair ;
// "ma2f_db_sync" était un fallback synchrone en clair (base entière —
// ventes, clients, caisse, dépenses...) ajouté ensuite pour un affichage
// instantané au démarrage, et supprimé le 2026-08-29 suite à l'audit de
// sécurité : stocker toute la base en clair dans le navigateur est lisible
// par une extension malveillante ou toute personne ayant accès au poste
// (ordinateur partagé, appareil d'un employé qui quitte l'entreprise...).
// On continue de nettoyer ces résidus pour les navigateurs qui les ont déjà
// écrits avant ce correctif.
const LEGACY_PLAINTEXT_KEYS = ["qprost_db", "ma2f_db_sync"];
// Autres clés locales non sensibles (timestamps, file d'attente hors-ligne)
// qu'on efface aussi à la déconnexion pour ne garder "que le minimum
// nécessaire" une fois l'utilisateur parti.
const SESSION_METADATA_KEYS = [
  "ma2f_last_update",
  "ma2f_last_sync",
  "ma2f_sync_queue",
  "ma2f_failed_ops",
];

// Génère ou récupère une clé de chiffrement depuis IndexedDB
async function getCryptoKey(): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEYS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
    };
    request.onsuccess = async () => {
      const db = request.result;
      const tx = db.transaction("keys", "readonly");
      const store = tx.objectStore("keys");
      const getReq = store.get(CRYPTO_KEY_NAME);
      getReq.onsuccess = async () => {
        if (getReq.result) {
          resolve(getReq.result);
        } else {
          // Générer une nouvelle clé
          const key = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
          );
          const txW = db.transaction("keys", "readwrite");
          txW.objectStore("keys").put(key, CRYPTO_KEY_NAME);
          resolve(key);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

// Chiffrer les données avant stockage
export async function encryptAndStore(data: object): Promise<void> {
  try {
    const key = await getCryptoKey();
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    // Stocker IV + données chiffrées en base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    const base64 = btoa(Array.from(combined).map(b => String.fromCharCode(b)).join(''));
    localStorage.setItem(STORAGE_KEY, base64);
    // Supprimer tout résidu d'un ancien stockage en clair
    LEGACY_PLAINTEXT_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Fallback silencieux - ne pas bloquer l'application
  }
}

// Déchiffrer les données depuis le stockage
export async function decryptFromStorage(): Promise<object | null> {
  try {
    // Vérifier d'abord s'il y a des données en clair (migration depuis une
    // ancienne version qui les stockait sans chiffrement)
    const plainData = localStorage.getItem("qprost_db");
    if (plainData) {
      const parsed = JSON.parse(plainData);
      // Migrer vers le stockage chiffré
      await encryptAndStore(parsed);
      localStorage.removeItem("qprost_db");
      return parsed;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const key = await getCryptoKey();
    const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );
    const text = new TextDecoder().decode(decrypted);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Supprime la clé de chiffrement IndexedDB elle-même (pas seulement les
// données chiffrées) : sans elle, le blob restant dans localStorage — s'il
// en restait un — serait indéchiffrable, et la prochaine connexion (même
// utilisateur ou un autre, sur un poste partagé) repart avec une clé neuve.
function deleteCryptoKey(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(KEYS_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Supprimer toutes les données stockées localement : le blob chiffré, la clé
// de chiffrement elle-même, tout résidu en clair d'une version antérieure, et
// les métadonnées de session (timestamps, file d'attente hors-ligne). Appelée
// à la déconnexion pour ne laisser aucune donnée métier accessible depuis le
// navigateur une fois l'utilisateur parti (poste partagé, appareil d'un
// employé qui quitte l'entreprise, etc.).
export async function clearSecureStorage(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  LEGACY_PLAINTEXT_KEYS.forEach((k) => localStorage.removeItem(k));
  SESSION_METADATA_KEYS.forEach((k) => localStorage.removeItem(k));
  await deleteCryptoKey();
}
