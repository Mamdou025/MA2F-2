import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { privateArchiveTransfer } from '../scripts/privateArchiveTransfer.ts';

test('private receiver verifies authentication, chunks, replay and assembled archive', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'ma2f-transfer-test-'));
  const output = path.join(temp, 'output');
  const configPath = path.join(temp, 'plan.json');
  const sha = b => createHash('sha256').update(b).digest('hex');
  const token = 'a'.repeat(64);
  const config = { token, files: [{ name: 'fixture.gz', bytes: 6, sha256: sha('abcdef'),
    chunks: [{ bytes: 3, sha256: sha('abc') }, { bytes: 3, sha256: sha('def') }] }] };
  writeFileSync(configPath, JSON.stringify(config));
  let handler;
  privateArchiveTransfer(configPath, output).configureServer({ middlewares: { use: (_path, fn) => { handler = fn; } } });
  const request = (url, data, authorization = 'Bearer ' + token, method = 'POST') => new Promise(resolve => {
    const req = Readable.from([Buffer.from(data)]);
    Object.assign(req, { url, method, headers: { authorization, 'content-length': String(data.length) } });
    const res = { statusCode: 200, setHeader() {}, end(body) { this.writableEnded = true; resolve({ status: this.statusCode, body: JSON.parse(body) }); } };
    handler(req, res);
  });
  try {
    assert.equal((await request('/0/0', 'abc', 'wrong')).status, 401);
    assert.equal((await request('/0/0', 'abc', 'Bearer ' + token, 'GET')).status, 405);
    assert.equal((await request('/9/0', 'abc')).status, 404);
    assert.equal((await request('/0/0', 'bad')).status, 422);
    assert.deepEqual(readdirSync(output), []);
    assert.equal((await request('/0/0', 'abc')).body.status, 'chunk_verified');
    assert.equal((await request('/0/0', 'abc')).body.status, 'chunk_verified');
    assert.equal((await request('/0/1', 'def')).body.status, 'archive_verified');
    assert.equal(readFileSync(path.join(output, 'fixture.gz'), 'utf8'), 'abcdef');
    assert.equal((await request('/0/1', 'def')).body.status, 'archive_verified');
  } finally {
    assert.equal(path.dirname(temp), path.resolve(tmpdir()));
    assert.ok(path.basename(temp).startsWith('ma2f-transfer-test-'));
    rmSync(temp, { recursive: true });
  }
});
