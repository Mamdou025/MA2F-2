import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOdooProbe } from '../server/odooHealth.ts';

const page = '<input name="login"><input name="password">';
test('shares concurrent probes, expires cached success, and recovers after outage', async () => {
  let time = Date.now(), calls = 0, healthy = true;
  const probe = createOdooProbe(async (_url, options) => {
    calls++;
    assert.ok(options.signal);
    assert.equal(options.redirect, 'error');
    return new Response(healthy ? page : 'unavailable', { status: healthy ? 200 : 502 });
  }, () => time);
  assert.deepEqual((await Promise.all([probe(), probe()])).map(r => r.connected), [true, true]);
  assert.equal(calls, 1);
  await probe(); assert.equal(calls, 1);
  healthy = false; time += 15_001;
  assert.equal((await probe()).connected, false);
  healthy = true; time += 15_001;
  assert.equal((await probe()).connected, true);
  assert.equal(calls, 3);
});
test('HTTP 200 from a proxy or maintenance page is not a healthy Odoo connection', async () => {
  const probe = createOdooProbe(async () => new Response('<html>Application starting</html>'));
  assert.equal((await probe()).connected, false);
});
test('network errors are sanitized', async () => {
  const probe = createOdooProbe(async () => { throw new Error('private connection detail'); });
  const result = await probe();
  assert.equal(result.connected, false);
  assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'connected']);
});
