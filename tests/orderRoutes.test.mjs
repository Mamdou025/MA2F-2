import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {orderRouter} from '../server/orderRoutes.ts';
test('order HTTP boundary requires native session, rights, origin and amounts without tax parameters',async()=>{
 let signed=false,active=true,role='admin',queued=0;const user={id:'native_actor',email:'fixture@example.invalid',emailVerified:true};
 const auth={auth:{api:{getSession:async()=>signed?{user}:null}},pool:{query:async sql=>({rows:sql.includes('FROM ma2f_auth."user"')?[user]:[{user_id:user.id,source_uid:'legacy',source_sha256:'a'.repeat(64),activation_enabled:active,source_disabled:false,profile:{id:'fixture',role,roles:[role],actif:true}}]})}};
 const queue={enqueue:async c=>{queued++;assert.equal(c.actorId,user.id);assert.equal(c.operation,'order');assert.equal(Object.hasOwn(c.payload,'taxId'),false);assert.equal(c.payload.unitPriceFCFA,600);return {requestId:c.requestId,state:'queued',result:null};},status:async(id,actor)=>{assert.equal(actor,user.id);return null;}};
 const origin='https://ma2f.example.invalid';
 const env={MA2F_AUTH_ORIGIN:origin,MA2F_LOCAL_AUTH_ENABLED:'true',MA2F_RUNTIME_ENABLED:'true',MA2F_ODOO_ORDERS_ENABLED:'true'};
 const app=express();app.use('/orders',orderRouter(env,{auth,queue}));app.use('/off',orderRouter({}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const body={requestId:randomUUID(),customerId:7,packs:7,unitPriceFCFA:600};
 const post=(b=body,from=origin)=>fetch(base+'/orders',{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{
  assert.equal((await fetch(base+'/off')).status,503);
  assert.equal((await post()).status,401);assert.equal(queued,0);signed=true;
  assert.equal((await post(body,'https://foreign.invalid')).status,403);
  assert.equal((await post({...body,actorId:'admin'})).status,400);
  assert.equal((await post({...body,taxId:0})).status,400);
  role='lecteur';assert.equal((await post()).status,403);role='admin';
  active=false;assert.equal((await post()).status,403);active=true;
  assert.equal(queued,0);
  const r=await post();assert.equal(r.status,202);assert.equal((await r.json()).state,'queued');assert.equal(queued,1);
  assert.equal((await fetch(base+'/orders/'+body.requestId)).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
