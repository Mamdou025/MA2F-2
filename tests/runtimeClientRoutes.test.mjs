import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {runtimeClientRouter} from '../server/runtimeClientRoutes.ts';
import {stateHash} from '../server/runtimeState.ts';
const origin='https://ma2f.example.invalid';
const c={id:'a',nom:'Original',type:'Boutique',zone:'Dakar',tel:'',prix:600};
const state={clients:[c],ventes:[],commandes:[],recouvrements:[]};

test('native client HTTP API enforces session, origin, role and strict payload',async()=>{
 let signedIn=false,role='admin',enabled=true,changed=0,reads=0;
 const user={id:'native',email:'x@example.invalid',emailVerified:true};
 const auth={auth:{api:{getSession:async()=>signedIn?{user}:null}},pool:{query:async sql=>{
  if(sql.includes('FROM ma2f_auth."user"'))return {rows:[user]};
  return {rows:[{user_id:'native',source_uid:'legacy',source_sha256:'a'.repeat(64),activation_enabled:enabled,source_disabled:false,profile:{id:'source',role,roles:[role],actif:true}}]};
 }}};
 const repository={read:async()=>{reads++;return {revision:'0',state};},change:async(id,actor,revision,changes,validate)=>{
  assert.equal(actor,'native');assert.equal(revision,'0');await validate(state,changes);changed++;return {revision:'1',replayed:false};
 }};
 const app=express();app.use('/api/clients',runtimeClientRouter({MA2F_AUTH_ORIGIN:origin,MA2F_LOCAL_AUTH_ENABLED:'true',MA2F_RUNTIME_ENABLED:'true'},{auth,repository}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}/api/clients`;
 const payload={requestId:randomUUID(),revision:'0',beforeHash:stateHash([c]),clients:[{...c,nom:'Updated'}]};
 const post=(body=payload,from=origin)=>fetch(url,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(url)).status,401);assert.equal(reads,0);
  signedIn=true;assert.equal((await fetch(url)).status,200);
  assert.equal((await post(payload,'https://foreign.example.invalid')).status,403);
  assert.equal((await post({...payload,role:'admin'})).status,400);assert.equal(changed,0);
  role='lecteur';assert.equal((await post()).status,403);assert.equal(changed,0);
  role='admin';assert.equal((await post()).status,200);assert.equal(changed,1);
  enabled=false;assert.equal((await fetch(url)).status,403);assert.equal((await post()).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
