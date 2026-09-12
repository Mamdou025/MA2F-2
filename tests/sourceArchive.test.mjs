import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateArchive, preserveArchive } from '../scripts/archive_firestore_snapshot.mjs';

const source = { project: 'ma2f-aquasachet', readTime: '2026-09-09T00:00:00.000000Z',
  documents: [{ name: 'projects/ma2f-aquasachet/databases/(default)/documents/a/b/c/d',
    fields: { n: { integerValue: '9007199254740993' } } }], collections: ['a','a/b/c'], missingParents: ['a/b'] };
const bytes = gzipSync(JSON.stringify(source));
const manifest = { project: source.project, readTime: source.readTime, documents: 1,
  collections: 2, missingParents: 1, firestoreComplete: true, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') };

test('source archive accepts nested paths and retains typed large integers', () => {
  assert.deepEqual(validateArchive(bytes, manifest).source, source);
});
test('source archive rejects damaged bytes, count mismatches and incomplete manifests', () => {
  assert.throws(() => validateArchive(Buffer.concat([bytes, Buffer.from('damage')]), manifest));
  assert.throws(() => validateArchive(bytes, { ...manifest, documents: 2 }));
  assert.throws(() => validateArchive(bytes, { ...manifest, firestoreComplete: false }));
});
test('archive restoration mismatch rolls back before commit', async () => {
  const queries = [];
  const db = { query: async sql => {
    queries.push(sql);
    if (sql.startsWith('SELECT sha256')) return { rowCount: 1 };
    if (sql.startsWith('SELECT archive,manifest')) return { rows: [{ archive: Buffer.from('damaged'), manifest }] };
    return { rows: [], rowCount: 0 };
  } };
  await assert.rejects(preserveArchive(db, bytes, manifest));
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(!queries.includes('COMMIT'));
});
