import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { CommandOutbox } from '../server/commandOutbox.ts';

assert.equal(process.argv[2], '--run-development', 'EXPLICIT_DEVELOPMENT_TEST_REQUIRED');
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, 'helium');
assert.equal(target.pathname, '/heliumdb');
const pool = new Pool({ connectionString: target.toString(), max: 5 });
const schema = 'ma2f_queue_test_' + randomUUID().replaceAll('-', '');
const table = '"' + schema + '".command_outbox';
let created = false, secondPool;
try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'heliumdb');
  await pool.query('CREATE SCHEMA "' + schema + '"'); created = true;
  const ddl = readFileSync('deployment/command-outbox.sql', 'utf8').replaceAll('CREATE TABLE command_outbox', 'CREATE TABLE ' + table)
    .replace('ON command_outbox(', 'ON ' + table + '(');
  await pool.query(ddl);
  const queue = new CommandOutbox(pool, schema);
  const command = { requestId: randomUUID(), actorId: 'fictional-user', operation: 'production', payload: { netPacks: 100, yield: 17 } };
  assert.equal((await queue.enqueue(command)).state, 'queued');
  assert.equal((await queue.enqueue({ ...command, payload: { yield: 17, netPacks: 100 } })).state, 'queued');
  await assert.rejects(queue.enqueue({ ...command, payload: { netPacks: 101 } }), /CONFLICT/);
  await assert.rejects(queue.enqueue({ ...command, actorId: 'different-user' }), /CONFLICT/);
  assert.equal(await queue.status(command.requestId, 'different-user'), null);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ' + table)).rows[0].count), 1);
  secondPool = new Pool({ connectionString: target.toString(), max: 2 });
  const restarted = new CommandOutbox(secondPool, schema);
  assert.equal((await restarted.status(command.requestId, command.actorId)).state, 'queued');
  const claims = await Promise.all([queue.claim(), restarted.claim(), queue.claim()]);
  const leased = claims.filter(Boolean); assert.equal(leased.length, 1);
  const first = leased[0];
  await pool.query(`UPDATE ${table} SET lease_until=now()-interval '1 second' WHERE request_id=$1`, [command.requestId]);
  const replacement = await restarted.claim(); assert.ok(replacement); assert.notEqual(first.lease, replacement.lease);
  await assert.rejects(queue.complete(first.requestId, first.lease, { requestId: first.requestId, state: 'done' }), /LEASE_LOST/);
  // Simulate an Odoo commit whose HTTP response was lost. No real Odoo write occurs.
  const committed = new Map([[command.requestId, { requestId: command.requestId, nativeId: 42, state: 'done' }]]);
  await restarted.uncertain(replacement.requestId, replacement.lease);
  assert.equal((await queue.status(command.requestId, command.actorId)).outcomeUnknown, true);
  await pool.query(`UPDATE ${table} SET available_at=now() WHERE request_id=$1`, [command.requestId]);
  const retry = await queue.claim(); assert.equal(retry.requestId, command.requestId);
  await queue.complete(retry.requestId, retry.lease, committed.get(retry.requestId));
  assert.equal((await restarted.status(command.requestId, command.actorId)).state, 'completed');
  assert.equal((await restarted.status(command.requestId, command.actorId)).outcomeUnknown, false);
  assert.equal(committed.size, 1);
  assert.equal(await queue.claim(), null);
  const orderCommand = {...command,requestId:randomUUID(),operation:'order'};
  const productionCommand = {...command,requestId:randomUUID()};
  await queue.enqueue(orderCommand);await queue.enqueue(productionCommand);
  const productionJob=await queue.claim('production');
  assert.equal(productionJob.requestId,productionCommand.requestId);
  assert.equal((await queue.status(orderCommand.requestId,command.actorId)).state,'queued');
  const orderJob=await queue.claim('order');assert.equal(orderJob.requestId,orderCommand.requestId);
  await queue.complete(productionJob.requestId,productionJob.lease,{requestId:productionJob.requestId});
  await queue.complete(orderJob.requestId,orderJob.lease,{requestId:orderJob.requestId});
  const exhausted = { ...command, requestId: randomUUID() };
  await queue.enqueue(exhausted);
  await pool.query(`UPDATE ${table} SET attempts=10,outcome_unknown=true WHERE request_id=$1`, [exhausted.requestId]);
  assert.equal(await queue.claim(), null);
  assert.equal((await queue.status(exhausted.requestId, command.actorId)).state, 'needs_review');
  console.log(JSON.stringify({ status: 'passed', database: 'development-only', checks: ['durable enqueue', 'duplicate and conflicting requests',
    'new connection persistence', 'concurrent claims', 'lease expiry and fencing', 'uncertain response retry', 'retry exhaustion'],
    realOdooWrites: 0 }));
} finally {
  await secondPool?.end();
  if (created) await pool.query('DROP SCHEMA "' + schema + '" CASCADE');
  await pool.end();
}
