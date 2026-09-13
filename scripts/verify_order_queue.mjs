/** Verify the actual restricted role; the test row is always rolled back. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {runtimeDatabaseConfig} from '../server/runtimeDatabase.ts';
assert.deepEqual(process.argv.slice(2),['--verify']);
const config=JSON.parse(readFileSync('/tmp/ma2f-order-runtime.json','utf8'));
const db=new pg.Client({connectionString:runtimeDatabaseConfig(config),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
try{
  await db.connect();await db.query('BEGIN');
  const role=(await db.query('SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(role,{name:'ma2f_app_runtime',rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false});
  const id=randomUUID();
  await db.query("INSERT INTO ma2f_runtime.command_outbox(request_id,actor_id,operation,payload,fingerprint) VALUES($1,'rollback_verification','order','{}',$2)",[id,'a'.repeat(64)]);
  assert.equal((await db.query('SELECT state FROM ma2f_runtime.command_outbox WHERE request_id=$1',[id])).rows[0].state,'queued');
  await db.query("UPDATE ma2f_runtime.command_outbox SET state='needs_review' WHERE request_id=$1",[id]);
  assert.equal((await db.query("SELECT has_table_privilege(current_user,'ma2f_runtime.command_outbox','DELETE') AS allowed")).rows[0].allowed,false);
  await db.query('ROLLBACK');
  assert.equal((await db.query('SELECT request_id FROM ma2f_runtime.command_outbox WHERE request_id=$1',[id])).rowCount,0);
  console.log(JSON.stringify({restrictedQueueRoleVerified:true,readInsertUpdatePassed:true,testRowRolledBack:true}));
}catch{await db.query('ROLLBACK').catch(()=>{});console.error('QUEUE_VERIFICATION_FAILED');process.exitCode=1;}
finally{await db.end();}
