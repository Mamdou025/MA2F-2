// Exact reviewed storage backup only. No public file serving or operational cutover.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from 'pg';

assert.equal(process.argv[2], '--apply');
const file = 'migration-private/incoming-20260909/storage-source-20260909.tar.gz';
const bytes = readFileSync(file);
const manifest = JSON.parse(readFileSync(file + '.manifest.json', 'utf8'));
const sha = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha, '4bd4040736b82121b065a3c106383ff63930b906589d2529cef68fd24650e20b');
assert.equal(manifest.sha256, sha);
assert.equal(manifest.objects, 114);
assert.equal(manifest.bytes, bytes.length);
assert.equal(manifest.fileReadbackVerified, true);
const target = new URL(readFileSync('/tmp/ma2f-auth-provision-uri', 'utf8').trim());
assert.equal(target.hostname, 'ep-falling-morning-adxx90io.c-2.us-east-1.aws.neon.tech');
assert.equal(target.pathname, '/neondb');
target.search = '';
const options = { connectionString: target.toString(), ssl: { rejectUnauthorized: true } };
const db = new Client(options);
try {
  await db.connect();
  await db.query('BEGIN');
  await db.query('CREATE SCHEMA IF NOT EXISTS ma2f_source');
  await db.query('REVOKE ALL ON SCHEMA ma2f_source FROM PUBLIC');
  await db.query(`CREATE TABLE IF NOT EXISTS ma2f_source.storage_archives (
    sha256 text PRIMARY KEY, manifest jsonb NOT NULL, archive bytea NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now())`);
  await db.query('REVOKE ALL ON ma2f_source.storage_archives FROM PUBLIC');
  await db.query('INSERT INTO ma2f_source.storage_archives(sha256,manifest,archive) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [sha, JSON.stringify(manifest), bytes]);
  const back = await db.query('SELECT archive,manifest FROM ma2f_source.storage_archives WHERE sha256=$1', [sha]);
  assert.deepEqual(back.rows[0].archive, bytes);
  assert.deepEqual(back.rows[0].manifest, manifest);
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ status: 'storage_archive_failed', code: error.code || error.name }));
  process.exitCode = 1;
} finally { await db.end(); }
if (!process.exitCode) {
  const check = new Client(options);
  try {
    await check.connect();
    const back = await check.query('SELECT archive FROM ma2f_source.storage_archives WHERE sha256=$1', [sha]);
    assert.deepEqual(back.rows[0].archive, bytes);
    console.log(JSON.stringify({ status: 'storage_archive_restored_in_new_connection', objects: 114,
      bytes: bytes.length, sha256: sha, operationalCutover: false }));
  } finally { await check.end(); }
}
