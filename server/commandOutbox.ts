import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type Command = { requestId: string; actorId: string; operation: string; payload: Record<string, unknown> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') + '}';
  throw new Error('INVALID_COMMAND_VALUE');
}

/** Internal durable queue. It is not an HTTP endpoint and never authorizes a user. */
export class CommandOutbox {
  private table: string;
  constructor(private pool: Pick<Pool, 'query'>, schema = 'ma2f_runtime') {
    if (!/^ma2f_(runtime|queue_test_[a-f0-9]+)$/.test(schema)) throw new Error('INVALID_OUTBOX_SCHEMA');
    this.table = '"' + schema + '".command_outbox';
  }

  async enqueue(command: Command) {
    if (!uuid.test(command.requestId) || !/^[A-Za-z0-9_-]{1,128}$/.test(command.actorId) ||
        !['order', 'production', 'receipt', 'delivery', 'transfer', 'return'].includes(command.operation) ||
        !command.payload || Array.isArray(command.payload)) throw new Error('INVALID_COMMAND');
    const payload = canonical(command.payload);
    if (Buffer.byteLength(payload) > 65536) throw new Error('COMMAND_TOO_LARGE');
    const fingerprint = createHash('sha256').update(canonical({ actorId: command.actorId, operation: command.operation, payload: command.payload })).digest('hex');
    // Autocommitted before any dispatch. A conflicting UUID cannot replace a command.
    await this.pool.query(`INSERT INTO ${this.table}(request_id,actor_id,operation,payload,fingerprint)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id) DO NOTHING`,
      [command.requestId, command.actorId, command.operation, payload, fingerprint]);
    const row = (await this.pool.query(`SELECT * FROM ${this.table} WHERE request_id=$1`, [command.requestId])).rows[0];
    if (!row || row.fingerprint !== fingerprint || row.actor_id !== command.actorId) throw new Error('COMMAND_ID_CONFLICT');
    return this.publicStatus(row);
  }

  private publicStatus(row: any) {
    return { requestId: row.request_id, state: row.state, outcomeUnknown: row.outcome_unknown,
      result: row.state === 'completed' ? row.result : null, error: row.error_code || null };
  }

  async status(requestId: string, actorId: string) {
    if (!uuid.test(requestId)) throw new Error('INVALID_REQUEST_ID');
    const row = (await this.pool.query(`SELECT * FROM ${this.table} WHERE request_id=$1 AND actor_id=$2`, [requestId, actorId])).rows[0];
    return row ? this.publicStatus(row) : null;
  }

  async claim(operation?: string) {
    if(operation!==undefined&&!['order','production','receipt','delivery','transfer','return'].includes(operation))throw Error('INVALID_OPERATION');
    const lease = randomUUID();
    // Fencing token prevents an expired worker from overwriting its replacement.
    const result = await this.pool.query(`WITH candidate AS (
      SELECT request_id FROM ${this.table}
      WHERE ((state='queued' AND available_at<=now()) OR (state='leased' AND lease_until<now()))
        AND ($2::text IS NULL OR operation=$2)
      ORDER BY created_at,request_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE ${this.table} q SET state=CASE WHEN attempts>=10 THEN 'needs_review' ELSE 'leased' END,
      outcome_unknown=q.outcome_unknown OR q.state='leased', attempts=attempts+1,
      lease_token=CASE WHEN attempts>=10 THEN NULL ELSE $1::uuid END,
      lease_until=CASE WHEN attempts>=10 THEN NULL ELSE now()+interval '30 seconds' END,updated_at=now()
      FROM candidate c WHERE q.request_id=c.request_id RETURNING q.*`, [lease,operation??null]);
    const row = result.rows[0];
    if (!row || row.state !== 'leased') return null;
    return { requestId: row.request_id, actorId: row.actor_id, operation: row.operation,
      payload: row.payload, lease, attempts: row.attempts };
  }

  async complete(requestId: string, lease: string, result: Record<string, unknown>) {
    if (result.requestId !== requestId) throw new Error('WRONG_ODOO_RECEIPT');
    const receipt = canonical(result);
    if (Buffer.byteLength(receipt) > 65536) throw new Error('RECEIPT_TOO_LARGE');
    const update = await this.pool.query(`UPDATE ${this.table} SET state='completed',result=$3,
      outcome_unknown=false,error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE request_id=$1 AND lease_token=$2 AND state='leased'`, [requestId, lease, receipt]);
    if (update.rowCount !== 1) throw new Error('LEASE_LOST');
  }

  async uncertain(requestId: string, lease: string) {
    const result = await this.pool.query(`UPDATE ${this.table} SET state='queued',outcome_unknown=true,
      error_code='ODOO_RESULT_UNCONFIRMED',available_at=now()+interval '5 seconds',
      lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE request_id=$1 AND lease_token=$2 AND state='leased'`, [requestId, lease]);
    if (result.rowCount !== 1) throw new Error('LEASE_LOST');
  }

  async review(requestId:string,lease:string){
    const result=await this.pool.query(`UPDATE ${this.table} SET state='needs_review',
      error_code='MANUAL_REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE request_id=$1 AND lease_token=$2 AND state='leased'`,[requestId,lease]);
    if(result.rowCount!==1)throw new Error('LEASE_LOST');
  }
}
