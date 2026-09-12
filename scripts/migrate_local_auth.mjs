// Explicit schema-only preparation. Never imports users or activates business access.
import { createLocalAuth } from '../server/localAuth.ts';
import { getMigrations } from 'better-auth/db/migration';

if (process.argv.length !== 3 || !['--plan', '--apply'].includes(process.argv[2])) {
  console.error('Usage: node --import tsx scripts/migrate_local_auth.mjs --plan|--apply');
  process.exit(2);
}
const { auth, pool } = createLocalAuth();
try {
  if (process.argv[2] === '--apply') {
    await pool.query('CREATE SCHEMA IF NOT EXISTS ma2f_auth');
    await pool.query('REVOKE ALL ON SCHEMA ma2f_auth FROM PUBLIC');
  }
  const schema = await pool.query("SELECT current_schema() AS schema");
  if (schema.rows[0].schema !== 'ma2f_auth') throw new Error('Create the dedicated auth schema with --apply first');
  const migration = await getMigrations(auth.options);
  if (migration.unsafeChanges.length || migration.schemaProblems.length) throw new Error('Auth schema requires review');
  if (process.argv[2] === '--plan') {
    console.log(await migration.compileMigrations());
  } else {
    await migration.runMigrations();
    console.log('Auth schema prepared. No users imported; business access remains disabled.');
  }
} catch {
  // Do not leak PostgreSQL connection details through migration failures.
  console.error('Auth schema preparation failed. Check database access and the migration plan.');
  process.exitCode = 1;
} finally { await pool.end(); }
