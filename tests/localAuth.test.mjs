import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { localAuthConfig } from '../server/localAuth.ts';
import { localAuthRouter } from '../server/localAuthRoutes.ts';

const config = { MA2F_AUTH_SECRET: 'fictional-test-secret-'.repeat(3),
  MA2F_AUTH_ORIGIN: 'https://ma2f.example.invalid', MA2F_AUTH_DATABASE_NAME: 'ma2f_app',
  MA2F_AUTH_DATABASE_URL: 'postgresql://auth:fictional@db.example.invalid/ma2f_app?sslmode=verify-full' };

test('auth requires explicit isolated database and exact origin', () => {
  const parsed = localAuthConfig(config);
  assert.equal(parsed.origin, config.MA2F_AUTH_ORIGIN);
  assert.equal(new URL(parsed.database).search, '');
  for (const bad of [ {}, { ...config, MA2F_AUTH_SECRET: 'short' },
    { ...config, MA2F_AUTH_ORIGIN: 'http://ma2f.example.invalid' },
    { ...config, MA2F_AUTH_ORIGIN: 'https://ma2f.example.invalid/path' },
    { ...config, MA2F_AUTH_ORIGIN: 'https://user:pass@ma2f.example.invalid' },
    { ...config, MA2F_AUTH_DATABASE_NAME: 'another_database' },
    { ...config, MA2F_AUTH_DATABASE_NAME: 'ma2f_odoo', MA2F_AUTH_DATABASE_URL: 'postgresql://auth:fictional@db.example.invalid/ma2f_odoo' },
    { ...config, MA2F_AUTH_DATABASE_URL: config.MA2F_AUTH_DATABASE_URL.replace('verify-full','disable') },
    { ...config, MA2F_AUTH_DATABASE_URL: config.MA2F_AUTH_DATABASE_URL + '&options=-c%20search_path=public' },
  ]) assert.throws(() => localAuthConfig(bad));
});

async function serve(router, run) {
  const app = express(); app.use('/api/local-auth', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/local-auth`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('disabled auth returns 503 without configuration or database access', async () => {
  await serve(localAuthRouter({}), async url => {
    for (const path of ['/profile','/sign-in/email','/get-session']) {
      const response = await fetch(url + path);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
});

test('session verification never turns an email or client role into business access', async () => {
  let session = null, fail = false, handled = 0;
  const runtime = { pool: { query: async () => ({ rows: [] }) }, auth: { api: { getSession: async () => {
    if (fail) throw new Error('private database failure'); return session;
  } }, handler: async request => { handled++; return Response.json({ path: new URL(request.url).pathname }); } } };
  await serve(localAuthRouter({ MA2F_LOCAL_AUTH_ENABLED:'true' }, runtime), async url => {
    assert.equal((await fetch(url + '/profile?role=admin')).status, 401);
    session = { user: { id:'user_1', email:'test@example.invalid', role:'admin' } };
    const response = await fetch(url + '/profile?role=admin');
    assert.deepEqual(await response.json(), { authenticated:true,
      user:{id:'user_1',email:'test@example.invalid'}, mapped:false, businessAccess:false, roles:[], directOdooAccess:false, sections:[] });
    for (const path of ['/sign-up/email','/request-password-reset','/update-user']) {
      assert.equal((await fetch(url + path, {method:'POST'})).status, 404);
    }
    assert.equal(handled, 0);
    const ok = await fetch(url + '/ok');
    assert.equal(ok.status,200);
    assert.equal((await ok.json()).path,'/api/local-auth/ok');
    fail = true;
    assert.deepEqual(await (await fetch(url + '/profile')).json(),{error:'local_auth_unavailable'});
    fail = false; session = null;
    assert.equal((await fetch(url + '/profile')).status,401);
  });
});

test('migration without an explicit mode fails before configuring a database', () => {
  const result = spawnSync(process.execPath, ['--import','tsx','scripts/migrate_local_auth.mjs'], {encoding:'utf8'});
  assert.equal(result.status,2);
  assert.match(result.stderr,/Usage:/);
});
