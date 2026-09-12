import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { localAuthOptions } from '../server/localAuth.ts';

test('native password setup uses one-time tokens; expired tokens fail and recovery revokes sessions', async () => {
  const store = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  const origin = 'https://ma2f.example.invalid';
  const options = localAuthOptions({ origin, secret: 'fictional-recovery-test-secret-123456789', database: '' }, memoryAdapter(store));
  let token;
  // Capture in memory only. This is not a configured production delivery service.
  options.emailAndPassword.sendResetPassword = async result => { token = result.token; };
  const auth = betterAuth(options);
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ name: 'Fixture', email: 'recovery@example.invalid', emailVerified: true });
  const request = (path, body, cookie) => auth.handler(new Request(origin + '/api/local-auth' + path, {
    method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) }));
  await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: origin + '/local-account' } });
  assert.ok(token);
  assert.equal(store.account.length, 0);
  const password = 'Fixture-Initial-Password-42!';
  assert.equal((await request('/reset-password', { token, newPassword: password })).status, 200);
  assert.equal((await request('/reset-password', { token, newPassword: password })).status, 400);
  const login = await request('/sign-in/email', { email: user.email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  await auth.api.requestPasswordReset({ body: { email: user.email } });
  const expired = store.verification.find(v => v.identifier === 'reset-password:' + token);
  expired.expiresAt = new Date(Date.now() - 1000);
  assert.equal((await request('/reset-password', { token, newPassword: 'Fixture-New-Password-42!' })).status, 400);
  assert.equal((await (await request('/get-session', null, cookie)).json()).user.id, user.id);
  await auth.api.requestPasswordReset({ body: { email: user.email } });
  const nextPassword = 'Fixture-Recovered-Password-42!';
  assert.equal((await request('/reset-password', { token, newPassword: nextPassword })).status, 200);
  assert.equal(await (await request('/get-session', null, cookie)).json(), null);
  assert.equal((await request('/sign-in/email', { email: user.email, password })).status, 401);
  assert.equal((await request('/sign-in/email', { email: user.email, password: nextPassword })).status, 200);
});
