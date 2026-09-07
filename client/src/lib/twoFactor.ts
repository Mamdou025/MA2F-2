/**
 * Module de Double Authentification (2FA) — MA2F AquaSachet
 * 
 * Implémente un système TOTP (Time-based One-Time Password) compatible
 * avec Google Authenticator, Authy, etc.
 * 
 * Fonctionnement :
 * 1. L'admin active la 2FA pour un utilisateur dans les paramètres
 * 2. Un secret est généré et affiché sous forme de QR code
 * 3. L'utilisateur scanne le QR avec son app d'authentification
 * 4. À chaque connexion, un code à 6 chiffres est demandé
 * 
 * Note : En l'absence de Cloud Functions déployées, le secret est stocké
 * dans Firestore (collection users). Avec les Cloud Functions, la vérification
 * se fait côté serveur pour une sécurité maximale.
 */

// Génère un secret aléatoire Base32 pour TOTP
export function generateTOTPSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  const array = new Uint8Array(20);
  crypto.getRandomValues(array);
  for (let i = 0; i < 20; i++) {
    secret += chars[array[i] % 32];
  }
  return secret;
}

// Convertit Base32 en Uint8Array
function base32Decode(encoded: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of encoded.toUpperCase()) {
    const val = chars.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  }
  return bytes;
}

// Calcule le HMAC-SHA1 (utilisé par TOTP)
async function hmacSHA1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return new Uint8Array(signature);
}

// Génère un code TOTP à partir du secret et du temps actuel
export async function generateTOTP(secret: string, timeStep: number = 30): Promise<string> {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / timeStep);
  
  // Convertir le temps en bytes (8 octets big-endian)
  const timeBytes = new Uint8Array(8);
  let t = time;
  for (let i = 7; i >= 0; i--) {
    timeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  
  const hmac = await hmacSHA1(key, timeBytes);
  
  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  
  return (code % 1000000).toString().padStart(6, "0");
}

// Vérifie un code TOTP (avec fenêtre de tolérance ±1 période)
export async function verifyTOTP(secret: string, inputCode: string, timeStep: number = 30): Promise<boolean> {
  // Vérifier la période actuelle et ±1 pour tolérance
  for (let offset = -1; offset <= 1; offset++) {
    const time = Math.floor(Date.now() / 1000 / timeStep) + offset;
    const timeBytes = new Uint8Array(8);
    let t = time;
    for (let i = 7; i >= 0; i--) {
      timeBytes[i] = t & 0xff;
      t = Math.floor(t / 256);
    }
    
    const key = base32Decode(secret);
    const hmac = await hmacSHA1(key, timeBytes);
    
    const off = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[off] & 0x7f) << 24) |
      ((hmac[off + 1] & 0xff) << 16) |
      ((hmac[off + 2] & 0xff) << 8) |
      (hmac[off + 3] & 0xff);
    
    const expected = (code % 1000000).toString().padStart(6, "0");
    if (expected === inputCode) return true;
  }
  return false;
}

// Génère l'URL otpauth:// pour le QR code
export function generateOTPAuthURL(secret: string, email: string, issuer: string = "MA2F-AquaSachet"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Rôles qui nécessitent la 2FA obligatoire
export const ROLES_2FA_REQUIRED = ["admin", "caissier"];

// Vérifie si un utilisateur doit utiliser la 2FA
export function is2FARequired(role: string): boolean {
  return ROLES_2FA_REQUIRED.includes(role);
}
