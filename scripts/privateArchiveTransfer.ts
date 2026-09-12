/** Temporary development-only receiver. Remove its Vite registration after use. */
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';

type FilePlan = { name: string; bytes: number; sha256: string; chunks: { bytes: number; sha256: string }[] };
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function privateArchiveTransfer(configPath = '/tmp/ma2f-transfer-plan.json', destinationRoot = path.resolve('migration-private/incoming-20260909')): Plugin {
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string; files: FilePlan[] };
  if (!/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Invalid transfer configuration');
  const root = destinationRoot;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const file of config.files) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(file.name) || ['.', '..'].includes(file.name) || !file.chunks.length ||
        file.bytes <= 0 || file.bytes > 256 * 1024 * 1024 ||
        file.chunks.some(c => c.bytes <= 0 || c.bytes > 4 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(c.sha256)) ||
        file.chunks.reduce((n, c) => n + c.bytes, 0) !== file.bytes || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('Invalid archive plan');
    }
  }
  return { name: 'ma2f-private-archive-transfer', configureServer(server) {
    server.middlewares.use('/api/migration-transfer', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const finish = (code: number, status: string) => { res.statusCode = code; res.end(JSON.stringify({ status })); };
      const presented = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(config.token);
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) { finish(401, 'unauthorized'); return; }
      if (req.method !== 'POST') { finish(405, 'post_required'); return; }
      const match = /^\/(\d+)\/(\d+)$/.exec(req.url || '');
      const file = match && config.files[Number(match[1])];
      const index = match ? Number(match[2]) : -1;
      const chunk = file && file.chunks[index];
      if (!file || !chunk) { finish(404, 'unknown_chunk'); return; }
      if (Number(req.headers['content-length']) !== chunk.bytes) { finish(413, 'size_mismatch'); return; }
      let size = 0, rejected = false;
      const buffers: Buffer[] = [];
      req.on('data', (data: Buffer) => {
        size += data.length;
        if (size > chunk.bytes) { rejected = true; buffers.length = 0; return; }
        if (!rejected) buffers.push(data);
      });
      req.on('error', () => { if (!res.writableEnded) finish(400, 'interrupted'); });
      req.on('end', () => {
        try {
          const bytes = Buffer.concat(buffers);
          if (rejected || size !== chunk.bytes || digest(bytes) !== chunk.sha256) { finish(422, 'checksum_mismatch'); return; }
          const destination = path.join(root, file.name + '.chunk-' + index);
          if (existsSync(destination)) {
            if (digest(readFileSync(destination)) !== chunk.sha256) throw new Error('Existing chunk mismatch');
          } else writeFileSync(destination, bytes, { mode: 0o600, flag: 'wx' });
          const parts = file.chunks.map((_, i) => path.join(root, file.name + '.chunk-' + i));
          if (parts.every(p => existsSync(p))) {
            const archive = Buffer.concat(parts.map(p => readFileSync(p)));
            if (archive.length !== file.bytes || digest(archive) !== file.sha256) throw new Error('Archive mismatch');
            const complete = path.join(root, file.name);
            if (existsSync(complete)) {
              if (digest(readFileSync(complete)) !== file.sha256) throw new Error('Existing archive mismatch');
            } else {
              writeFileSync(complete + '.verified', archive, { mode: 0o600, flag: 'wx' });
              renameSync(complete + '.verified', complete);
            }
            finish(200, 'archive_verified');
          } else finish(200, 'chunk_verified');
        } catch { finish(500, 'transfer_failed'); }
      });
    });
  } };
}
