/** One-time production schema/role preparation; no account or application cutover. */
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { createLocalAuth } from '../server/localAuth.ts';

if (process.argv[2] !== '--apply' || process.argv.length !== 3) {
  console.error('Explicit --apply required'); process.exit(2);
}
const input='/tmp/ma2f-auth-provision-uri', output='/tmp/ma2f-auth-runtime.json';
if (existsSync(output) || (statSync(input).mode & 0o077)) throw new Error('Private preparation inputs required');
const u=new URL(readFileSync(input,'utf8'));
if(u.hostname!=='ep-falling-morning-adxx90io.c-2.us-east-1.aws.neon.tech' || u.pathname!=='/neondb') throw new Error('Unexpected database target');
u.search='';
const owner=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true}});
let authPool;
try {
  await owner.connect();
  const existing=await owner.query("SELECT 1 FROM pg_roles WHERE rolname='ma2f_auth_runtime'");
  if(existing.rowCount) throw new Error('Existing runtime role requires review');
  const password=randomBytes(48).toString('hex');
  const secret=randomBytes(48).toString('hex');
  await owner.query('BEGIN');
  await owner.query(`CREATE ROLE ma2f_auth_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await owner.query('CREATE SCHEMA ma2f_auth');
  await owner.query('REVOKE ALL ON SCHEMA ma2f_auth FROM PUBLIC');
  await owner.query('GRANT USAGE ON SCHEMA ma2f_auth TO ma2f_auth_runtime');
  await owner.query('COMMIT');
  // Persist the newly generated credential privately before subsequent steps.
  const runtime=new URL(u); runtime.username='ma2f_auth_runtime'; runtime.password=password;
  const config={MA2F_AUTH_ORIGIN:'https://aquasachets.replit.app',MA2F_AUTH_DATABASE_NAME:'neondb',
    MA2F_AUTH_DATABASE_URL:runtime.toString(),MA2F_AUTH_SECRET:secret,MA2F_LOCAL_AUTH_ENABLED:'false'};
  writeFileSync(output,JSON.stringify(config),{mode:0o600,flag:'wx'});
  const {auth,pool}=createLocalAuth({...config,MA2F_AUTH_DATABASE_URL:u.toString()}); authPool=pool;
  const migration=await getMigrations(auth.options);
  if(migration.unsafeChanges.length || migration.schemaProblems.length) throw new Error('Unsafe schema plan');
  await migration.runMigrations();
  await owner.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ma2f_auth TO ma2f_auth_runtime');
  await owner.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ma2f_auth TO ma2f_auth_runtime');
  const rows=await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='ma2f_auth' ORDER BY tablename");
  console.log(JSON.stringify({status:'schema_prepared',tables:rows.rows.map(x=>x.tablename),accountsImported:0,businessAccess:false}));
} catch {
  await owner.query('ROLLBACK').catch(()=>{});
  console.error('Auth preparation failed; inspect private checkpoint before retrying.'); process.exitCode=1;
} finally {if(authPool)await authPool.end(); await owner.end();}
