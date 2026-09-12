// One-off, pinned source archive import. Run from ma2f-next in Replit only.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/home/runner/workspace/package.json');
const { Client } = require('pg');
const archive = readFileSync('migration-private/business-source-20260908.json.gz');
const sha = createHash('sha256').update(archive).digest('hex');
assert.equal(sha, '82afd0419934a23a5d48ccd31615347ac5c1655ff93063ef6b19ff7b440cb548');
const source = JSON.parse(gunzipSync(archive, { maxOutputLength: 20000000 }));
assert.equal(source.project, 'ma2f-aquasachet');
assert.equal(source.version, 1);
const prefix = 'projects/ma2f-aquasachet/databases/(default)/documents/';
const docs = new Map();
const counts = {};
for (const d of source.documents) {
  assert.ok(d.name.startsWith(prefix));
  assert.equal(d.name.slice(prefix.length).split('/').length, 2);
  assert.ok(!docs.has(d.name));
  docs.set(d.name, d);
  const col = d.name.slice(prefix.length).split('/')[0];
  assert.ok(!Object.hasOwn(source.excluded, col));
  counts[col] = (counts[col] || 0) + 1;
}
for (const [col, count] of Object.entries(source.counts)) assert.equal(counts[col] || 0, count);
assert.deepEqual(Object.keys(counts).sort(), Object.keys(source.counts).filter(k => source.counts[k] > 0).sort());
console.log(JSON.stringify({ phase: 'validated', documents: docs.size, collections: Object.keys(source.counts).length, apply: process.argv.includes('--apply') }));
if (process.argv.includes('--apply')) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('ma2f-source-import'))");
    const previous = await db.query('SELECT status FROM ma2f_migration.source_runs WHERE archive_sha256=$1', [sha]);
    const reused = previous.rowCount > 0;
    if (!reused) {
      await db.query('INSERT INTO ma2f_migration.source_runs(archive_sha256,project,read_time,expected_documents,manifest,status) VALUES($1,$2,$3,$4,$5,$6)', [sha, source.project, source.readTime, docs.size, JSON.stringify({ counts: source.counts, excluded: source.excluded, scope: source.scope }), 'importing']);
      const rows = [...docs.values()].map(d => ({ document_path: d.name, collection_id: d.name.slice(prefix.length).split('/')[0], source_document: d, document_sha256: createHash('sha256').update(JSON.stringify(d)).digest('hex') }));
      for (let n = 0; n < rows.length; n += 200) {
        await db.query('INSERT INTO ma2f_migration.source_documents(archive_sha256,document_path,collection_id,source_document,document_sha256) SELECT $1,x.document_path,x.collection_id,x.source_document,x.document_sha256 FROM jsonb_to_recordset($2::jsonb) AS x(document_path text,collection_id text,source_document jsonb,document_sha256 text)', [sha, JSON.stringify(rows.slice(n, n + 200))]);
      }
    }
    const back = await db.query('SELECT document_path,source_document FROM ma2f_migration.source_documents WHERE archive_sha256=$1', [sha]);
    assert.equal(back.rowCount, docs.size);
    for (const row of back.rows) assert.deepEqual(row.source_document, docs.get(row.document_path));
    await db.query("UPDATE ma2f_migration.source_runs SET status='verified' WHERE archive_sha256=$1", [sha]);
    await db.query('COMMIT');
    console.log(JSON.stringify({ phase: 'verified', documents: back.rowCount, reused, operationalCutover: false }));
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify({ phase: 'failed', code: e.code || e.name }));
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
