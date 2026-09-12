import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderDispatcher,runOrderOnce,validateOrderPayload} from '../server/orderWorker.ts';
import {CommandOutbox} from '../server/commandOutbox.ts';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const p={customerId:7,packs:7,unitPriceFCFA:600};
const job={requestId:id,actorId:'actor_1',operation:'order',payload:p,lease:'lease',attempts:1};
const env={MA2F_ODOO_ORDERS_ENABLED:'true',ODOO_COMMAND_API_KEY:'test-key',ODOO_DATABASE:'ma2f_odoo',ODOO_COMPANY_ID:'1',ODOO_BASE_URL:'https://odoo.example.invalid'};
const receipt={requestId:id,orderId:42,orderName:'S00042',state:'draft',...p,totalFCFA:4200,stockReserved:false,invoicePosted:false,replayed:false};
function queue(){const calls=[];return {calls,claim:async op=>{assert.equal(op,'order');return structuredClone(job);},complete:async(...a)=>calls.push(['complete',...a]),uncertain:async(...a)=>calls.push(['uncertain',...a]),review:async(...a)=>calls.push(['review',...a])};}
test('order transport fixes destination and validates receipt, bounds and flags',async()=>{
 let writes=0;
 const send=async(url,options)=>{writes++;assert.equal(url,env.ODOO_BASE_URL+'/json/2/ma2f.core.operation/record_order');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer test-key');assert.deepEqual(JSON.parse(options.body),{command:{requestId:id,actorId:'actor_1',...p},context:{allowed_company_ids:[1]}});return Response.json({...receipt,secret:'discarded'});};
 assert.deepEqual(await orderDispatcher(env,send)(job),receipt);
 for(const patch of [{MA2F_ODOO_ORDERS_ENABLED:'false'},{ODOO_COMMAND_API_KEY:''},{ODOO_DATABASE:'other'},{ODOO_COMPANY_ID:'2'}])await assert.rejects(orderDispatcher({...env,...patch},send)(job));
 assert.equal(writes,1);
 for(const patch of [{requestId:'wrong'},{totalFCFA:4201},{state:'sale'},{stockReserved:true},{invoicePosted:true},{orderId:0},{taxId:9},{customerId:8}])await assert.rejects(orderDispatcher(env,async()=>Response.json({...receipt,...patch}))(job),/UNCONFIRMED/);
 await assert.rejects(orderDispatcher(env,async()=>new Response('x'.repeat(20000)))(job),/UNCONFIRMED/);
 for(const value of [{...p,packs:true},{...p,packs:0},{...p,unitPriceFCFA:1.5},{...p,companyId:1},{...p,taxId:4},{customerId:7,packs:7,unitPriceIncludedFCFA:600},null])assert.throws(()=>validateOrderPayload(value),/INVALID/);
});
test('lost order response retries same UUID; never treats a timeout as success',async()=>{
 const q=queue();let created=0;const commands=[];
 const send=orderDispatcher(env,async(_url,options)=>{commands.push(JSON.parse(options.body));if(!created){created++;throw Error('lost after commit');}return Response.json({...receipt,replayed:true});});
 assert.equal(await runOrderOnce(q,send,async()=>true,true),'unconfirmed');
 assert.equal(q.calls[0][0],'uncertain');
 assert.equal(await runOrderOnce(q,send,async()=>true,true),'completed');
 assert.deepEqual(commands[0],commands[1]);assert.equal(created,1);assert.equal(q.calls[1][3].replayed,true);
});
test('disabled and revoked order actors cannot dispatch',async()=>{
 const q=queue();let claimed=0,sent=0;q.claim=async()=>{claimed++;return job;};const send=async()=>{sent++;return receipt;};
 assert.equal(await runOrderOnce(q,send,async()=>true,false),'disabled');assert.equal(claimed,0);
 assert.equal(await runOrderOnce(q,send,async()=>false,true),'needs_review');assert.equal(sent,0);
});
test('queue workers filter their operation before leasing',async()=>{
 const calls=[];const q=new CommandOutbox({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
 await q.claim('order');assert.match(calls[0].sql,/AND \(\$2::text IS NULL OR operation=\$2\)/);assert.equal(calls[0].args[1],'order');
 await q.claim('production');assert.equal(calls[1].args[1],'production');
 await assert.rejects(q.claim('bad'));assert.equal(calls.length,2);
});
