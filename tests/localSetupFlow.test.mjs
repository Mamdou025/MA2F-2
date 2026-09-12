import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { localAuthOptions } from '../server/localAuth.ts';
import { localAuthRouter } from '../server/localAuthRoutes.ts';
import { issueSetupLink } from '../scripts/issue_local_setup_link.mjs';

test('private administrator link completes native HTTP password setup without opening public issuance or business access', async () => {
  const store = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  const database = memoryAdapter(store);
  const config = { origin: 'https://ma2f.example.invalid', secret: 'fixture-setup-flow-secret-123456789', database: '' };
  const auth = betterAuth(localAuthOptions(config, database));
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ name: 'Fixture', email: 'setup@example.invalid', emailVerified: true });
  let privateLink;
  await issueSetupLink({ email: user.email, output: '/tmp/ma2f-setup-fixture.json', config,
    pool: { query: async () => ({ rowCount: 1, rows: [{ ...user, source_disabled: false, profile: { actif: true } }] }) },
    createAuth: options => betterAuth({ ...options, database }),
    write: (_path, text) => { privateLink = JSON.parse(text).url; },
  });
  const token = new URLSearchParams(new URL(privateLink).hash.slice(1)).get('token');
  assert.ok(token);
  const app = express();
  app.use('/api/local-auth', localAuthRouter({ MA2F_LOCAL_AUTH_ENABLED: 'true' }, { auth, pool: { query: async () => ({ rows: [] }) } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/local-auth`;
  const request = (path, body, cookie) => fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { origin: config.origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const password = 'Fixture private initial password 123!';
    assert.equal((await request('/setup')).status, 200);
    assert.equal((await request('/request-password-reset', { email: user.email })).status, 404);
    assert.equal((await request('/reset-password', { token, newPassword: password })).status, 200);
    assert.equal((await request('/reset-password', { token, newPassword: password })).status, 400);
    const login = await request('/sign-in/email', { email: user.email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const profile = await (await request('/profile', null, cookie)).json();
    assert.equal(profile.authenticated, true);
    assert.equal(profile.businessAccess, false);
    assert.equal(profile.directOdooAccess, false);
    assert.deepEqual(profile.roles, []);
    assert.equal(store.account.length, 1);
    assert.equal((await request('/sign-out', {}, cookie)).status, 200);
    assert.equal((await request('/profile', null, cookie)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
