import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalProfile, loadLocalProfile } from '../server/localProfile.ts';
const user = { id: 'legacy_fixture', email: 'fixture@example.invalid', emailVerified: true };
const row = { user_id: user.id, source_uid: 'source_fixture', source_sha256: 'a'.repeat(64),
  activation_enabled: false, source_disabled: false, profile: { id: 'app_fixture', actif: true,
    role: 'commercial', roles: ['commercial'], allowedSections: ['clients'], permissions: { clients: ['read', 'create'] } } };

test('preserves server profile without activating or granting direct Odoo access', () => {
  const profile = resolveLocalProfile({ ...user, role: 'admin', roles: ['admin'] }, row);
  assert.equal(profile.mapped, true);
  assert.equal(profile.businessAccess, false);
  assert.equal(profile.directOdooAccess, false);
  assert.deepEqual(profile.roles, ['commercial']);
  assert.deepEqual(profile.permissions, row.profile.permissions);
  profile.roles.push('admin'); profile.permissions.clients.push('delete');
  assert.deepEqual(row.profile.roles, ['commercial']);
  assert.deepEqual(row.profile.permissions.clients, ['read', 'create']);
});
test('activation requires an active preserved identity and verified session', () => {
  const active = { ...row, activation_enabled: true };
  assert.equal(resolveLocalProfile(user, active).businessAccess, true);
  for (const record of [null, { ...active, source_disabled: true }, { ...active, source_sha256: '' },
    { ...active, profile: { ...row.profile, actif: false } }, { ...active, user_id: 'other' },
    { ...active, profile: { ...row.profile, roles: ['invented'] } },
    { ...active, profile: { ...row.profile, allowedSections: [] } }]) {
    assert.equal(resolveLocalProfile(user, record).businessAccess, false);
  }
  assert.equal(resolveLocalProfile({ ...user, emailVerified: false }, active).businessAccess, false);
});
test('profile loads use the session id and observe immediate revocation', async () => {
  let active = true;
  const pool = { query: async (sql, values) => {
    assert.deepEqual(values, [user.id]); assert.match(sql, /WHERE user_id=\$1/);
    return { rows: [{ ...row, activation_enabled: active }] };
  } };
  assert.equal((await loadLocalProfile(pool, user)).businessAccess, true);
  active = false;
  assert.equal((await loadLocalProfile(pool, user)).businessAccess, false);
});
