/** Explicit production setup; does not activate a user or enable order processing. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

assert.ok(['--plan','--apply'].includes(process.argv[2])&&process.argv.length===3);
const input='/tmp/ma2f-auth-provision-uri',output='/tmp/ma2f-order-runtime.json';
assert.equal(statSync(input).mode&0o077,0,'PRIVATE_INPUT_REQUIRED');
const uri=new URL(readFileSync(input,'utf8').trim());
assert.equal(uri.protocol,'postgresql:');
assert.equal(uri.hostname,'ep-falling-morning-adxx90io.c-2.us-east-1.aws.neon.tech');
assert.equal(uri.pathname,'/neondb');uri.search='';
const db=new pg.Client({connectionString:uri.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
try{
  await db.connect();
  const role=(await db.query("SELECT 1 FROM pg_roles WHERE rolname='ma2f_app_runtime'")).rowCount;
  const table=(await db.query("SELECT to_regclass('ma2f_runtime.command_outbox') AS name")).rows[0].name;
  if(process.argv[2]==='--plan'){console.log(JSON.stringify({roleExists:Boolean(role),queueExists:Boolean(table),businessFlagsChanged:false}));}
  else{
    assert.ok(!role&&!table&&!existsSync(output),'EXISTING_SETUP_REQUIRES_REVIEW');
    const password=randomBytes(48).toString('hex');
    await db.query('BEGIN');
    await db.query(`CREATE ROLE ma2f_app_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await db.query('CREATE SCHEMA IF NOT EXISTS ma2f_runtime');
    await db.query('REVOKE ALL ON SCHEMA ma2f_runtime FROM PUBLIC');
    await db.query('SET LOCAL search_path=ma2f_runtime');
    await db.query(readFileSync(new URL('../deployment/command-outbox.sql',import.meta.url),'utf8'));
    await db.query('REVOKE ALL ON ma2f_runtime.command_outbox FROM PUBLIC');
    await db.query('GRANT USAGE ON SCHEMA ma2f_runtime TO ma2f_app_runtime');
    await db.query('GRANT SELECT,INSERT,UPDATE ON ma2f_runtime.command_outbox TO ma2f_app_runtime');
    const runtime=new URL(uri);runtime.username='ma2f_app_runtime';runtime.password=password;runtime.search='?sslmode=verify-full';
    writeFileSync(output,JSON.stringify({MA2F_RUNTIME_DATABASE_URL:runtime.toString(),MA2F_RUNTIME_DATABASE_NAME:'neondb'}),{mode:0o600,flag:'wx'});
    await db.query('COMMIT');
    console.log(JSON.stringify({queuePrepared:true,businessFlagsChanged:false,privateConfiguration:output}));
  }
}catch{
  await db.query('ROLLBACK').catch(()=>{});
  console.error('QUEUE_SETUP_FAILED: inspect private configuration checkpoint before retrying; no credentials logged.');process.exitCode=1;
}finally{await db.end();}
