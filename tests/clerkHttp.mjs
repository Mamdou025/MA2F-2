import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['dist/index.js'],{env:{...process.env,PORT:'5099',NODE_ENV:'production'},stdio:'ignore'});
try {
 let ready=false;
 for(let i=0;i<50;i++) {if(child.exitCode!==null)throw Error('Temporary server exited');try{ready=(await fetch('http://127.0.0.1:5099/healthz')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(ready,true);
 for(const port of [5000,5099]){
  for(const headers of [{},{Authorization:'Bearer invalid-token'}]){
   const response=await fetch('http://127.0.0.1:'+port+'/api/clerk-verification',{headers});
   assert.equal(response.status,401);assert.equal((await response.json()).authenticated,false);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(response.headers.has('access-control-allow-origin'),false);
  }
  assert.equal((await fetch('http://127.0.0.1:'+port+'/',{headers:{Authorization:'Bearer invalid-token'}})).status,200);
 }
 console.log(JSON.stringify({httpChecks:'passed',runtimes:['development','production'],unauthenticated:401,invalidToken:401,legacyPage:200}));
}finally{child.kill();}
