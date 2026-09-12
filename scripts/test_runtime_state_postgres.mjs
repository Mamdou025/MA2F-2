import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { RuntimeStateRepository, stateHash } from '../server/runtimeState.ts';

assert.equal(process.argv[2],'--run-development');
const url=new URL(process.env.DATABASE_URL || '');
assert.equal(url.hostname,'helium');assert.equal(url.pathname,'/heliumdb');
const pool=new Pool({connectionString:url.toString(),max:5});
const schema='ma2f_state_test_'+randomBytes(8).toString('hex');
const initial={clients:[{id:'source-1',nom:'Original',unknownLegacyField:'preserved'}],commandes:[],params:{oldAnomaly:-12}};
try {
 await pool.query(`CREATE SCHEMA "${schema}"`);
 const sql=readFileSync(new URL('../deployment/runtime-state.sql',import.meta.url),'utf8');
 const client=await pool.connect();
 try {await client.query('BEGIN');await client.query(`SET LOCAL search_path="${schema}"`);await client.query(sql);await client.query(`INSERT INTO app_state(source_sha256,source_read_time,state,provenance) VALUES($1,now(),$2,$3)`,['a'.repeat(64),JSON.stringify(initial),'{}']);await client.query('COMMIT');}finally{client.release();}
 const repo=new RuntimeStateRepository(pool,schema);
 const changes=[{field:'clients',beforeHash:stateHash(initial.clients),value:[...initial.clients,{id:'new-1',nom:'New'}]}];
 const request=randomUUID();let validations=0;
 const validate=async state=>{assert.deepEqual(state,initial);validations++;};
 const repeated=await Promise.all([repo.change(request,'actor_a','0',changes,validate),repo.change(request,'actor_a','0',changes,validate)]);
 assert.equal(validations,1);assert.equal(repeated.filter(r=>r.replayed).length,1);
 assert.deepEqual((await repo.read()).state,{...initial,clients:changes[0].value});
 await assert.rejects(repo.change(request,'actor_b','0',changes,validate),{message:'REQUEST_ID_CONFLICT'});
 await assert.rejects(repo.change(randomUUID(),'actor_a','0',changes,validate),{message:'STATE_REVISION_CONFLICT'});
 await assert.rejects(repo.change(randomUUID(),'actor_a','1',changes,validate),{message:'STATE_FIELD_CONFLICT'});
 const fresh=[{field:'clients',beforeHash:stateHash(changes[0].value),value:initial.clients}];
 await assert.rejects(repo.change(randomUUID(),'actor_a','1',fresh,async()=>{throw new Error('PERMISSION_DENIED');}),{message:'PERMISSION_DENIED'});
 assert.equal((await repo.read()).revision,'1');
 const competing=await Promise.allSettled([repo.change(randomUUID(),'actor_a','1',fresh,()=>{}),repo.change(randomUUID(),'actor_b','1',fresh,()=>{})]);
 assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(competing.filter(r=>r.status==='rejected' && r.reason.message==='STATE_REVISION_CONFLICT').length,1);
 const independent=new Pool({connectionString:url.toString()});
 try {const result=await new RuntimeStateRepository(independent,schema).read();assert.equal(result.revision,'2');assert.deepEqual(result.state,initial);}finally{await independent.end();}
 assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".state_changes`)).rows[0].n,2);
 console.log(JSON.stringify({passed:true,concurrentDuplicates:true,conflicts:true,asyncValidationRollback:true,independentConnection:true,sourceAnomaliesPreserved:true,productionWrites:0}));
} finally {await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
