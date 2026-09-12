import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { localAuthRouter } from '../server/localAuthRoutes.ts';

test('password setup page is isolated, uncached, and keeps its token out of request URLs', async () => {
  let authRequests = 0;
  const runtime = { auth: { handler: async () => { authRequests++; return Response.json({ status: true }); } } };
  const app = express(); app.use('/api/local-auth', localAuthRouter({ MA2F_LOCAL_AUTH_ENABLED: 'true' }, runtime));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/local-auth';
  try {
    const page = await fetch(base + '/setup'); const html = await page.text();
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /connect-src 'self'/);
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
    assert.ok(html.includes('<script nonce="' + nonce + '">'));
    assert.ok(html.includes('location.hash')); assert.ok(html.includes('history.replaceState'));
    assert.ok(!html.includes('firebase')); assert.ok(!html.includes('clerk'));
    assert.equal(authRequests, 0);
    const login = await fetch(base + '/login');
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('cache-control'), 'no-store');
    assert.match(login.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const loginHtml = await login.text();
    assert.ok(loginHtml.includes("'/api/local-auth/sign-in/email'"));
    assert.ok(loginHtml.includes("'/api/local-auth/sign-out'"));
    assert.ok(!loginHtml.includes('firebase'));
    assert.ok(!loginHtml.includes('clerk'));
    assert.equal((await fetch(base + '/request-password-reset', { method: 'POST' })).status, 404);
    assert.equal((await fetch(base + '/sign-up/email', { method: 'POST' })).status, 404);
    assert.equal((await fetch(base + '/reset-password', { method: 'POST' })).status, 200);
    assert.equal(authRequests, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
