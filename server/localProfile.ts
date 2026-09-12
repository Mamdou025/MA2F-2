import type { Pool } from 'pg';
import { ROLE_SECTIONS } from '../shared/accessPolicy';

const roles = new Set(['admin', 'caissier', 'commercial', 'lecteur']);
const actions = new Set(['read', 'create', 'edit', 'delete']);
type SessionUser = { id: string; email: string; emailVerified: boolean };

/** Interpret only the preserved, server-owned profile. No email allowlist grants. */
export function resolveLocalProfile(user: SessionUser, row: any) {
  const denied = { mapped: false as const, businessAccess: false as const, roles: [] as string[], directOdooAccess: false as const };
  if (!row || row.user_id !== user.id || typeof row.source_uid !== 'string' || !row.source_uid ||
      !/^[a-f0-9]{64}$/.test(row.source_sha256 || '') || typeof row.activation_enabled !== 'boolean' ||
      typeof row.source_disabled !== 'boolean') return denied;
  const profile = row.profile;
  if (!profile || typeof profile.id !== 'string' || !profile.id || typeof profile.actif !== 'boolean' ||
      !roles.has(profile.role) || !Array.isArray(profile.roles) || !profile.roles.length ||
      !profile.roles.every((r: unknown) => typeof r === 'string' && roles.has(r)) ||
      !profile.roles.includes(profile.role) || new Set(profile.roles).size !== profile.roles.length) return denied;
  if (profile.allowedSections !== undefined && (!Array.isArray(profile.allowedSections) ||
      !profile.allowedSections.length || !profile.allowedSections.every((s: unknown) => typeof s === 'string' && s.length > 0))) return denied;
  if (profile.permissions !== undefined && (!profile.permissions || typeof profile.permissions !== 'object' ||
      Array.isArray(profile.permissions) || !Object.values(profile.permissions).every(v =>
        Array.isArray(v) && v.every(a => typeof a === 'string' && actions.has(a))))) return denied;
  return { mapped: true as const, sourceUserId: profile.id, roles: [...profile.roles] as string[],
    primaryRole: profile.role as string,
    allowedSections: profile.allowedSections === undefined ? null : [...profile.allowedSections] as string[],
    permissions: structuredClone(profile.permissions || {}) as Record<string, string[]>,
    accountEligible: !row.source_disabled && profile.actif && user.emailVerified === true,
    businessAccess: row.activation_enabled && !row.source_disabled && profile.actif && user.emailVerified === true,
    directOdooAccess: false as const };
}

export type LocalProfile = ReturnType<typeof resolveLocalProfile>;

export function localSections(profile: LocalProfile): string[] {
  if (!profile.mapped) return [];
  return profile.allowedSections === null
    ? Array.from(new Set(profile.roles.flatMap(role => ROLE_SECTIONS[role] || [])))
    : [...profile.allowedSections];
}

/** Permission checks apply to server-owned profiles and every individual operation. */
export function canLocalAction(profile: LocalProfile, section: string, action: string): boolean {
  if (!profile.mapped || !profile.businessAccess || !actions.has(action) || !localSections(profile).includes(section)) return false;
  if (['utilisateurs', 'parametres', 'backups', 'securite', 'actionnaires'].includes(section) && !profile.roles.includes('admin')) return false;
  if (action !== 'read' && !profile.roles.some(role => ['admin', 'caissier', 'commercial'].includes(role))) return false;
  if (Object.hasOwn(profile.permissions, section)) return profile.permissions[section].includes(action);
  return true;
}

/** Re-read every time so revocation does not depend on a browser token or cache. */
export async function loadLocalProfile(pool: Pick<Pool, 'query'>, user: SessionUser) {
  const result = await pool.query(`SELECT user_id,source_uid,source_sha256,profile,source_disabled,activation_enabled
    FROM ma2f_auth.business_profile WHERE user_id=$1`, [user.id]);
  return resolveLocalProfile(user, result.rows[0]);
}
