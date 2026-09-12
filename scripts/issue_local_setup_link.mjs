/** Administrator-operated CLI. Never exposes issuance through an HTTP endpoint. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { localAuthConfig, localAuthOptions } from '../server/localAuth.ts';

export async function issueSetupLink({ email: suppliedEmail, output, config, pool, createAuth = betterAuth, write = writeFileSync }) {
const email = suppliedEmail?.trim().toLowerCase();
assert.ok(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'EMAIL_REQUIRED');
assert.ok(output?.startsWith('/tmp/ma2f-setup-') && output.endsWith('.json') && !output.slice(5).includes('/'), 'PRIVATE_OUTPUT_REQUIRED');
  const result = await pool.query(`SELECT u.id,u."emailVerified",p.profile,p.source_disabled
    FROM ma2f_auth."user" u JOIN ma2f_auth.business_profile p ON p.user_id=u.id WHERE lower(u.email)=$1`, [email]);
  assert.equal(result.rowCount, 1, 'PRESERVED_IDENTITY_REQUIRED');
  const user = result.rows[0];
  assert.equal(user.emailVerified, true, 'VERIFIED_SOURCE_EMAIL_REQUIRED');
  assert.equal(user.source_disabled, false, 'DISABLED_SOURCE_IDENTITY');
  assert.equal(user.profile?.actif, true, 'INACTIVE_SOURCE_PROFILE');
  const options = localAuthOptions(config, pool);
  options.logger = { disabled: true };
  let written = false;
  options.emailAndPassword.sendResetPassword = async ({ token, user: issuedUser }) => {
    assert.equal(issuedUser.id, user.id);
    const url = new URL('/api/local-auth/setup', config.origin);
    url.hash = new URLSearchParams({ token }).toString();
    assert.ok(token && typeof token === 'string', 'TOKEN_REQUIRED');
    write(output, JSON.stringify({ url: url.toString(), userId: user.id,
      expiresAt: new Date(Date.now() + 900_000).toISOString(), businessAccessChanged: false }), { mode: 0o600, flag: 'wx' });
    written = true;
  };
  const auth = createAuth(options);
  await auth.api.requestPasswordReset({ body: { email } });
  assert.equal(written, true, 'LINK_NOT_WRITTEN');
  return { status: 'private_setup_link_created', expiresInMinutes: 15, businessAccessChanged: false };
}

async function main() {
let pool;
try {
  assert.equal(process.argv[2], '--issue', 'ISSUE_REQUIRED');
  const config = localAuthConfig();
  pool = new Pool({ connectionString: config.database, ssl: { rejectUnauthorized: true },
    options: '-c search_path=ma2f_auth', max: 1, connectionTimeoutMillis: 8000 });
  console.log(JSON.stringify(await issueSetupLink({ email: process.argv[3], output: process.argv[4], config, pool })));
} catch (error) {
  // Never print a database error, URL, token or credential to terminal logs.
  const known = new Set(['ISSUE_REQUIRED', 'EMAIL_REQUIRED', 'PRIVATE_OUTPUT_REQUIRED', 'PRESERVED_IDENTITY_REQUIRED',
    'VERIFIED_SOURCE_EMAIL_REQUIRED', 'DISABLED_SOURCE_IDENTITY', 'INACTIVE_SOURCE_PROFILE', 'TOKEN_REQUIRED', 'LINK_NOT_WRITTEN']);
  console.error(JSON.stringify({ status: 'setup_link_not_issued', code: known.has(error.message) ? error.message : 'ISSUANCE_FAILED' }));
  process.exitCode = 1;
} finally { await pool?.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
