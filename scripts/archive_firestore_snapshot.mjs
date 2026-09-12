// Preserve an immutable source snapshot; never post operational stock or sales.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { Client } from 'pg';

export function validateArchive(bytes, manifest) {
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha, manifest.sha256);
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(manifest.firestoreComplete, true);
  assert.equal(manifest.project, 'ma2f-aquasachet');
  const source = JSON.parse(gunzipSync(bytes, { maxOutputLength: 250_000_000 }));
  assert.equal(source.project, manifest.project);
  assert.equal(source.readTime, manifest.readTime);
  assert.ok(Number.isFinite(Date.parse(source.readTime)));
  const prefix = `projects/${source.project}/databases/(default)/documents/`;
  const seen = new Set();
  for (const document of source.documents) {
    assert.ok(document.name.startsWith(prefix));
    assert.equal(document.name.slice(prefix.length).split('/').length % 2, 0);
    assert.ok(!seen.has(document.name));
    seen.add(document.name);
  }
  assert.equal(source.documents.length, manifest.documents);
  assert.equal(source.collections.length, manifest.collections);
  assert.equal(source.missingParents.length, manifest.missingParents);
  return { sha, source };
}

export async function preserveArchive(db, bytes, manifest) {
  const { sha, source } = validateArchive(bytes, manifest);
  await db.query('BEGIN');
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('ma2f-complete-source-archive'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS ma2f_source');
    await db.query('REVOKE ALL ON SCHEMA ma2f_source FROM PUBLIC');
    await db.query(`CREATE TABLE IF NOT EXISTS ma2f_source.archives (
      sha256 text PRIMARY KEY, read_time timestamptz NOT NULL, manifest jsonb NOT NULL,
      archive bytea NOT NULL, imported_at timestamptz NOT NULL DEFAULT now())`);
    await db.query(`CREATE TABLE IF NOT EXISTS ma2f_source.documents (
      archive_sha256 text REFERENCES ma2f_source.archives(sha256), path text NOT NULL,
      source_document jsonb NOT NULL, PRIMARY KEY(archive_sha256,path))`);
    await db.query('REVOKE ALL ON ALL TABLES IN SCHEMA ma2f_source FROM PUBLIC');
    const prior = await db.query('SELECT sha256 FROM ma2f_source.archives WHERE sha256=$1', [sha]);
    if (!prior.rowCount) {
      await db.query('INSERT INTO ma2f_source.archives(sha256,read_time,manifest,archive) VALUES($1,$2,$3,$4)',
        [sha, source.readTime, JSON.stringify(manifest), bytes]);
      for (let i = 0; i < source.documents.length; i += 200) {
        const rows = source.documents.slice(i, i + 200).map(d => ({ path: d.name, source_document: d }));
        await db.query(`INSERT INTO ma2f_source.documents SELECT $1,x.path,x.source_document
          FROM jsonb_to_recordset($2::jsonb) AS x(path text,source_document jsonb)`, [sha, JSON.stringify(rows)]);
      }
    }
    const restored = await db.query('SELECT archive,manifest FROM ma2f_source.archives WHERE sha256=$1', [sha]);
    assert.deepEqual(restored.rows[0].archive, bytes);
    assert.deepEqual(restored.rows[0].manifest, manifest);
    validateArchive(restored.rows[0].archive, restored.rows[0].manifest);
    const documents = await db.query('SELECT path,source_document FROM ma2f_source.documents WHERE archive_sha256=$1', [sha]);
    assert.equal(documents.rowCount, source.documents.length);
    const expected = new Map(source.documents.map(d => [d.name, d]));
    for (const row of documents.rows) assert.deepEqual(row.source_document, expected.get(row.path));
    await db.query('COMMIT');
    return { status: 'archive_restoration_verified', sha256: sha, documents: documents.rowCount,
      reused: !!prior.rowCount, operationalCutover: false };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

if (process.argv.includes('--apply')) {
  const path = process.argv[process.argv.indexOf('--archive') + 1];
  assert.ok(path && path !== process.argv[0]);
  const target = new URL(readFileSync('/tmp/ma2f-auth-provision-uri', 'utf8').trim());
  assert.equal(target.hostname, 'ep-falling-morning-adxx90io.c-2.us-east-1.aws.neon.tech');
  assert.equal(target.pathname, '/neondb');
  target.search = '';
  const db = new Client({ connectionString: target.toString(), ssl: { rejectUnauthorized: true } });
  try {
    const bytes = readFileSync(path);
    const manifest = JSON.parse(readFileSync(path + '.manifest.json', 'utf8'));
    validateArchive(bytes, manifest);
    await db.connect();
    console.log(JSON.stringify(await preserveArchive(db, bytes, manifest)));
  } catch (error) {
    console.error(JSON.stringify({ status: 'archive_failed', code: error.code || error.name }));
    process.exitCode = 1;
  } finally { await db.end(); }
}
