import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productionDispatcher,runProductionOnce} from '../server/productionWorker.ts';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const job={requestId:id,actorId:'actor_1',operation:'production',payload:{netPacks:17,packsPerKg:'17',sourceSha256:'a'.repeat(64)},lease:'lease',attempts:1};
const env={MA2F_ODOO_WRITES_ENABLED:'true',ODOO_COMMAND_API_KEY:'test-command-key',ODOO_DATABASE:'ma2f_odoo',ODOO_COMPANY_ID:'1',ODOO_BASE_URL:'https://odoo.example.invalid'};
const receipt={requestId:id,productionId:42,productionName:'TEST/42',saleablePacks:17,sachetsPerPack:30,consumptionBasis:'source_estimate',sourceSha256:'a'.repeat(64),estimatedKgNumerator:17,estimatedKgDenominator:17,appliedKg:1,replayed:false};
function queue(){const calls=[];return {calls,claim:async()=>structuredClone(job),complete:async(...args)=>calls.push(['complete',...args]),uncertain:async(...args)=>calls.push(['uncertain',...args]),review:async(...args)=>calls.push(['review',...args])};}
test('fixed production RPC uses separate server key and rejects mismatched receipts',async()=>{
 let requests=0;
 const fetcher=async(url,options)=>{requests++;assert.equal(url,env.ODOO_BASE_URL+'/json/2/ma2f.core.operation/record_production');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer test-command-key');
   assert.deepEqual(JSON.parse(options.body),{command:{requestId:id,actorId:'actor_1',saleablePacks:17,sourceSha256:'a'.repeat(64),packsPerKg:'17'},context:{allowed_company_ids:[1]}});
   return Response.json({...receipt,untrustedExtra:'discard'});};
 assert.deepEqual(await productionDispatcher(env,fetcher)(job),receipt);
 await assert.rejects(productionDispatcher({...env,MA2F_ODOO_WRITES_ENABLED:'false'},fetcher)(job),/DISABLED/);
 await assert.rejects(productionDispatcher({...env,ODOO_COMMAND_API_KEY:''},fetcher)(job),/DISABLED/);
 assert.equal(requests,1);
 for(const patch of [{requestId:'wrong'},{saleablePacks:18},{sourceSha256:'b'.repeat(64)},{estimatedKgDenominator:18},{appliedKg:0},{productionId:null}])
   await assert.rejects(productionDispatcher(env,async()=>Response.json({...receipt,...patch}))(job),/UNCONFIRMED/);
 await assert.rejects(productionDispatcher(env,async()=>new Response('x'.repeat(17000)))(job),/UNCONFIRMED/);
});
test('lost response retries the same command and only completes on a matching replay receipt',async()=>{
 const q=queue();let committed=false,stockWrites=0,seen=[];
 const dispatch=productionDispatcher(env,async(_url,options)=>{
   const command=JSON.parse(options.body).command;seen.push(command);
   if(!committed){committed=true;stockWrites++;throw Error('connection lost after simulated commit');}
   return Response.json({...receipt,replayed:true});
 });
 assert.equal(await runProductionOnce(q,dispatch,async()=>true,true),'unconfirmed');
 assert.equal(q.calls[0][0],'uncertain');assert.equal(q.calls.some(c=>c[0]==='complete'),false);
 assert.equal(await runProductionOnce(q,dispatch,async()=>true,true),'completed');
 assert.deepEqual(seen[0],seen[1]);assert.equal(stockWrites,1);assert.equal(q.calls[1][3].replayed,true);
});
test('disabled workers do not claim and revoked actors do not dispatch',async()=>{
 const q=queue();let claims=0,dispatches=0;q.claim=async()=>{claims++;return job;};
 const dispatch=async()=>{dispatches++;return receipt;};
 assert.equal(await runProductionOnce(q,dispatch,async()=>true,false),'disabled');assert.equal(claims,0);
 assert.equal(await runProductionOnce(q,dispatch,async()=>false,true),'needs_review');assert.equal(dispatches,0);assert.equal(q.calls[0][0],'review');
});
