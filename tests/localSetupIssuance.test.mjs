import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSetupLink } from '../scripts/issue_local_setup_link.mjs';

const config = { origin: 'https://ma2f.example.invalid', secret: 'fixture-secret-for-issuing-links-only', database: '' };
const row = { id: 'preserved-fixture', emailVerified: true, profile: { actif: true }, source_disabled: false };
function fixture(overrides = {}) {
  const state = { calls: [], files: [] };
  const args = { email: ' FIXTURE@example.invalid ', output: '/tmp/ma2f-setup-fixture.json', config,
    pool: { query: async (sql, parameters) => { state.calls.push({ sql, parameters }); return { rowCount: 1, rows: [row] }; } },
    createAuth: options => ({ api: { requestPasswordReset: async ({ body }) => {
      assert.equal(body.email, 'fixture@example.invalid');
      assert.equal(options.emailAndPassword.disableSignUp, true);
      assert.equal(options.emailAndPassword.resetPasswordTokenExpiresIn, 900);
      await options.emailAndPassword.sendResetPassword({ token: 'fictional+token/value', user: row });
    } } }),
    write: (...values) => state.files.push(values), ...overrides };
  return { state, args };
}

test('administrator issuance preserves access and writes only a private, exclusive fragment link', async () => {
  const { state, args } = fixture();
  const result = await issueSetupLink(args);
  assert.deepEqual(result, { status: 'private_setup_link_created', expiresInMinutes: 15, businessAccessChanged: false });
  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0].sql, /^SELECT/);
  assert.deepEqual(state.calls[0].parameters, ['fixture@example.invalid']);
  const [file, contents, flags] = state.files[0];
  assert.equal(file, args.output);
  assert.deepEqual(flags, { mode: 0o600, flag: 'wx' });
  const payload = JSON.parse(contents), url = new URL(payload.url);
  assert.equal(url.origin, config.origin);
  assert.equal(url.pathname, '/api/local-auth/setup');
  assert.equal(url.search, '');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), 'fictional+token/value');
  assert.equal(payload.businessAccessChanged, false);
  assert.ok(Date.parse(payload.expiresAt) > Date.now() + 890000);
  assert.ok(!JSON.stringify(result).includes('fictional+token'));
});

test('issuance refuses missing, disabled, unverified and inactive preserved identities', async () => {
  for (const result of [
    { rowCount: 0, rows: [] }, { rowCount: 2, rows: [row, row] },
    ...[{ source_disabled: true }, { emailVerified: false }, { profile: { actif: false } }, { profile: null }]
      .map(patch => ({ rowCount: 1, rows: [{ ...row, ...patch }] })),
  ]) {
    const { state, args } = fixture({ pool: { query: async () => result } });
    await assert.rejects(issueSetupLink(args));
    assert.equal(state.files.length, 0);
  }
});

test('issuance cannot report success without delivery, overwrite a file or issue for a different identity', async () => {
  for (const createAuth of [
    () => ({ api: { requestPasswordReset: async () => ({ status: true }) } }),
    options => ({ api: { requestPasswordReset: async () => options.emailAndPassword.sendResetPassword({
      token: 'fixture', user: { id: 'different-user' } }) } }),
  ]) {
    const { state, args } = fixture({ createAuth });
    await assert.rejects(issueSetupLink(args));
    assert.equal(state.files.length, 0);
  }
  const { args } = fixture({ write: () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); } });
  await assert.rejects(issueSetupLink(args), { code: 'EEXIST' });
  for (const output of ['/tmp/public.json', '/tmp/ma2f-setup-../../public.json', '/home/runner/workspace/ma2f-setup-x.json']) {
    await assert.rejects(issueSetupLink({ ...args, output }), /PRIVATE_OUTPUT_REQUIRED/);
  }
});
