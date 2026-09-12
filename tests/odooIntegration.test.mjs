import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createIntegrationReader, integrationConfig } from '../server/odooIntegration.ts';
import { integrationDiagnosticHandler } from '../server/odooIntegrationRoutes.ts';

const config = { ODOO_BASE_URL: 'https://odoo.example.invalid', ODOO_DATABASE: 'ma2f_odoo',
  ODOO_API_KEY: 'fictional-private-key', ODOO_COMPANY_ID: '7' };
test('fixed company read keeps credentials on the server and writes disabled', async () => {
  let calls = 0;
  const inspect = createIntegrationReader(async (url, options) => {
    calls++;
    assert.equal(url, 'https://odoo.example.invalid/json/2/res.company/search_read');
    assert.equal(options.headers.Authorization, 'Bearer fictional-private-key');
    assert.equal(options.headers['X-Odoo-Database'], 'ma2f_odoo');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { domain: [['id', '=', 7]], fields: ['id', 'name'],
      limit: 1, context: { allowed_company_ids: [7] } });
    return Response.json([{ id: 7, name: 'Fictitious test company' }]);
  }, config);
  const result = await inspect();
  assert.equal(calls, 1);
  assert.equal(result.apiAuthenticated, true);
  assert.equal(result.businessWritesEnabled, false);
  assert.equal(result.stockMappingVerified, false);
  assert.ok(!JSON.stringify(result).includes('fictional-private-key'));
});

for (const [name, response, code] of [
  ['invalid key', () => new Response('secret traceback', { status: 401 }), 'odoo_credentials_or_permissions_rejected'],
  ['forbidden', () => new Response('secret traceback', { status: 403 }), 'odoo_credentials_or_permissions_rejected'],
  ['bad gateway', () => new Response('secret traceback', { status: 502 }), 'odoo_api_unavailable'],
  ['empty company', () => Response.json([]), 'odoo_company_not_accessible'],
  ['wrong company', () => Response.json([{ id: 8, name: 'Wrong' }]), 'odoo_company_not_accessible'],
  ['HTML startup page', () => new Response('<html>starting</html>'), 'odoo_api_unavailable'],
  ['oversized response', () => new Response('a'.repeat(17000)), 'odoo_response_invalid'],
  ['network failure', () => { throw new Error('secret credential in network error'); }, 'odoo_api_unavailable'],
]) test(name + ' is sanitized', async () => {
  await assert.rejects(createIntegrationReader(async () => response(), config), { message: code });
});

test('missing and unsafe configuration fails before network access', async () => {
  for (const env of [{}, { ...config, ODOO_BASE_URL: 'http://example.invalid' },
    { ...config, ODOO_BASE_URL: 'https://user:password@example.invalid' },
    { ...config, ODOO_BASE_URL: 'https://example.invalid/path' },
    { ...config, ODOO_COMPANY_ID: '0' }, { ...config, ODOO_COMPANY_ID: '7.5' }]) {
    assert.throws(() => integrationConfig(env));
  }
});

function fixture(role = 'admin') {
  return { mapped: true, accountEligible: true, businessAccess: false, roles: [role] };
}

test('native HTTP diagnostic checks current profile and revocation before Odoo', async () => {
  let profile = null, calls = 0;
  const app = express();
  app.get('/connection', integrationDiagnosticHandler({ profile: async () => profile,
    inspect: async () => { calls++; return { apiAuthenticated: true, businessWritesEnabled: false }; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/connection?role=admin`;
  try {
    assert.equal((await fetch(url)).status, 401);
    profile = fixture('lecteur');
    assert.equal((await fetch(url)).status, 403);
    profile = { mapped: false, roles: ['admin'] };
    assert.equal((await fetch(url)).status, 403);
    assert.equal(calls, 0);
    profile = fixture();
    const success = await fetch(url);
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');
    assert.equal((await success.json()).businessWritesEnabled, false);
    assert.equal(calls, 1);
    profile.accountEligible = false;
    assert.equal((await fetch(url)).status, 403);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
