import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { canLocalAction, resolveLocalProfile } from '../server/localProfile.ts';
import { requireLocalAction } from '../server/localAuthorization.ts';
const user = { id: 'fixture', email: 'fixture@example.invalid', emailVerified: true };
const row = { user_id: user.id, source_uid: 'firebase-fixture', source_sha256: 'a'.repeat(64),
  source_disabled: false, activation_enabled: true, profile: { id: 'app-fixture', actif: true,
    role: 'commercial', roles: ['commercial'], allowedSections: ['clients'], permissions: { clients: ['read', 'create'] } } };

test('action authorization honors custom restrictions, role defaults, and protected administration', () => {
  const profile = resolveLocalProfile(user, row);
  assert.equal(canLocalAction(profile, 'clients', 'create'), true);
  assert.equal(canLocalAction(profile, 'clients', 'delete'), false);
  assert.equal(canLocalAction(profile, 'ventes', 'read'), false);
  const reader = resolveLocalProfile(user, { ...row, profile: { ...row.profile, role: 'lecteur', roles: ['lecteur'],
    allowedSections: ['clients', 'utilisateurs'], permissions: { clients: ['create'] } } });
  assert.equal(canLocalAction(reader, 'clients', 'create'), false);
  assert.equal(canLocalAction(reader, 'utilisateurs', 'read'), false);
  const defaults = resolveLocalProfile(user, { ...row, profile: { ...row.profile, allowedSections: undefined, permissions: {} } });
  assert.equal(canLocalAction(defaults, 'commandes', 'create'), true);
  assert.equal(canLocalAction(defaults, 'production', 'create'), false);
  assert.equal(canLocalAction(defaults, 'commandes', 'invented'), false);
});

test('HTTP boundary rechecks revocation and rejects forged roles and source ids', async () => {
  let session = null, record = row, failure = false, writes = 0;
  const runtime = { auth: { api: { getSession: async () => session } }, pool: { query: async (_sql, params) => {
    if (failure) throw new Error('private database details');
    assert.deepEqual(params, [user.id]); return { rows: [record] };
  } } };
  const app = express();
  app.post('/write', requireLocalAction(runtime, 'clients', 'create'), (_req, res) => { writes++; res.json({ userId: res.locals.ma2f.userId }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const call = () => fetch(`http://127.0.0.1:${server.address().port}/write?role=admin&userId=other`, { method: 'POST', headers: { 'x-role': 'admin' } });
  try {
    assert.equal((await call()).status, 401);
    session = { user: { ...user, role: 'admin' } };
    assert.deepEqual(await (await call()).json(), { userId: user.id });
    record = { ...row, activation_enabled: false };
    assert.equal((await call()).status, 403);
    record = { ...row, profile: { ...row.profile, permissions: { clients: ['read'] } } };
    assert.equal((await call()).status, 403);
    failure = true;
    const failed = await call(); assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'local_authorization_unavailable' });
    assert.equal(writes, 1);
  } finally { await new Promise(r => server.close(r)); }
});
