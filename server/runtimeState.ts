import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export function canonicalJson(value: unknown): string {
  if (value === null || ['string','boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as any)[k])).join(',')+'}';
  throw new Error('INVALID_JSON_VALUE');
}
export const stateHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export type StateChange = { field: string; beforeHash: string; value: unknown };

/** Internal repository: callers must authorize and validate every change before invoking it. */
export class RuntimeStateRepository {
  private schema: string;
  constructor(private pool: Pick<Pool,'connect'|'query'>, schema='ma2f_runtime') {
    if (!/^ma2f_(runtime|state_test_[a-f0-9]+)$/.test(schema)) throw new Error('INVALID_STATE_SCHEMA');
    this.schema='"'+schema+'"';
  }
  async read() {
    const row=(await this.pool.query(`SELECT revision::text,source_sha256,source_read_time,state,provenance FROM ${this.schema}.app_state WHERE singleton=true`)).rows[0];
    if (!row) throw new Error('RUNTIME_STATE_NOT_INITIALIZED');
    return row;
  }
  async change(requestId: string, actorId: string, expectedRevision: string, changes: StateChange[],
    validate: (state: Record<string,unknown>, changes: StateChange[])=>void | Promise<void>) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(actorId) || !/^(0|[1-9][0-9]{0,18})$/.test(expectedRevision) ||
        !Array.isArray(changes) || !changes.length || changes.length>40 ||
        new Set(changes.map(c=>c?.field)).size!==changes.length) throw new Error('INVALID_STATE_CHANGE');
    for(const c of changes) if (!c || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(c.field) ||
      ['constructor','prototype','__proto__'].includes(c.field) || !/^[a-f0-9]{64}$/.test(c.beforeHash)) throw new Error('INVALID_STATE_CHANGE');
    const serialized=canonicalJson(changes);
    if(Buffer.byteLength(serialized)>4*1024*1024) throw new Error('STATE_CHANGE_TOO_LARGE');
    const fingerprint=stateHash({actorId,expectedRevision,changes});
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      // State row serializes writers and retry lookup, including duplicate concurrent requests.
      const current=(await client.query(`SELECT revision::text,state FROM ${this.schema}.app_state WHERE singleton=true FOR UPDATE`)).rows[0];
      if(!current) throw new Error('RUNTIME_STATE_NOT_INITIALIZED');
      const previous=(await client.query(`SELECT actor_id,fingerprint,revision::text FROM ${this.schema}.state_changes WHERE request_id=$1`,[requestId])).rows[0];
      if(previous) {
        if(previous.actor_id!==actorId || previous.fingerprint!==fingerprint) throw new Error('REQUEST_ID_CONFLICT');
        await client.query('COMMIT'); return {revision:previous.revision,replayed:true};
      }
      if(current.revision!==expectedRevision) throw new Error('STATE_REVISION_CONFLICT');
      for(const c of changes) if(!Object.hasOwn(current.state,c.field) || stateHash(current.state[c.field])!==c.beforeHash) throw new Error('STATE_FIELD_CONFLICT');
      await validate(structuredClone(current.state),structuredClone(changes));
      const next={...current.state};for(const c of changes) next[c.field]=c.value;
      const result=(await client.query(`UPDATE ${this.schema}.app_state SET state=$1,revision=revision+1,updated_at=now() WHERE singleton=true RETURNING revision::text`,[JSON.stringify(next)])).rows[0];
      await client.query(`INSERT INTO ${this.schema}.state_changes(request_id,actor_id,fingerprint,revision,changes) VALUES($1,$2,$3,$4,$5)`,[requestId,actorId,fingerprint,result.revision,serialized]);
      await client.query('COMMIT');return {revision:result.revision,replayed:false};
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
}
