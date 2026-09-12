/** Resolve a server-fetched migration profile. This never activates business access. */
export function resolveClerkProfile(sessionUserId: string, user: any) {
  const denied = { mapped: false, businessAccess: false, roles: [], directOdooAccess: false };
  if (!sessionUserId || user?.id !== sessionUserId || user.banned || user.locked) return denied;
  const m = user.privateMetadata?.ma2fMigration;
  const p = m?.profile;
  if (m?.version !== 1 || m.project !== "ma2f-aquasachet" ||
      typeof m.firebaseUid !== "string" || !m.firebaseUid ||
      user.externalId !== `firebase:ma2f-aquasachet:${m.firebaseUid}` ||
      !/^[a-f0-9]{64}$/.test(m.sourceSha256 ?? "") ||
      m.activationAllowed !== false || m.directOdooAccess !== false) return denied;
  if (!p || p.actif !== true ||
      ![p.id, p.nom, p.login, p.email].every(x => typeof x === "string" && x.trim())) return denied;
  const knownRoles = new Set(["admin", "caissier", "commercial", "lecteur"]);
  if (!Array.isArray(p.roles) || !p.roles.length ||
      !p.roles.every((r: unknown) => typeof r === "string" && knownRoles.has(r)) ||
      new Set(p.roles).size !== p.roles.length || !p.roles.includes(p.role)) return denied;
  if (!Array.isArray(user.emailAddresses) || !user.emailAddresses.some((e: any) =>
      e.id === user.primaryEmailAddressId && e.emailAddress === p.email &&
      e.verification?.status === "verified")) return denied;
  if (Object.hasOwn(p, "allowedSections") &&
      (!Array.isArray(p.allowedSections) || !p.allowedSections.length ||
       !p.allowedSections.every((s: unknown) => typeof s === "string" && s.length > 0))) return denied;
  // Historical non-empty action matrices require a separate enforcement review.
  if (Object.hasOwn(p, "permissions") && (!p.permissions || Array.isArray(p.permissions) ||
      typeof p.permissions !== "object" || Object.keys(p.permissions).length)) return denied;
  return {
    ...denied,
    mapped: true,
    profile: {
      id: p.id, nom: p.nom, role: p.role, roles: [...p.roles],
      ...(Object.hasOwn(p, "allowedSections") ? { allowedSections: [...p.allowedSections] } : {}),
      ...(Object.hasOwn(p, "permissions") ? { permissions: {} } : {}),
    },
  };
}
