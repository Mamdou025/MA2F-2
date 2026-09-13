/** Enable one already-preserved account; never constructs a role from an email. */
import assert from 'node:assert/strict';
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {resolveLocalProfile,canLocalAction} from '../server/localProfile.ts';
assert.ok(['--plan','--apply'].includes(process.argv[2])&&process.argv.length===4);
const email=process.argv[3].trim().toLowerCase();assert.match(email,/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const file='/tmp/ma2f-auth-provision-uri';assert.equal(statSync(file).mode&0o077,0);
const u=new URL(readFileSync(file,'utf8').trim());
assert.equal(u.hostname,'ep-falling-morning-adxx90io.c-2.us-east-1.aws.neon.tech');assert.equal(u.pathname,'/neondb');u.search='';
const db=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
try{
  await db.connect();await db.query('BEGIN');
  const result=await db.query(`SELECT u.id,u.email,u."emailVerified",p.*,
    EXISTS(SELECT 1 FROM ma2f_auth.account a WHERE a."userId"=u.id AND a."providerId"='credential' AND a.password IS NOT NULL) AS password_ready
    FROM ma2f_auth."user" u JOIN ma2f_auth.business_profile p ON p.user_id=u.id
    WHERE lower(u.email)=$1 FOR UPDATE OF p`,[email]);
  assert.equal(result.rowCount,1,'PRESERVED_ACCOUNT_REQUIRED');const row=result.rows[0];
  const profile=resolveLocalProfile(row,{...row,activation_enabled:true});
  assert.ok(canLocalAction(profile,'commandes','create'),'PRESERVED_ORDER_PERMISSION_REQUIRED');
  if(process.argv[2]==='--apply'){
    assert.equal(row.password_ready,true,'PASSWORD_SETUP_REQUIRED');
    writeFileSync('/tmp/ma2f-order-profile-before-'+randomUUID()+'.json',JSON.stringify({userId:row.id,activationEnabled:row.activation_enabled}),{mode:0o600,flag:'wx'});
    await db.query('UPDATE ma2f_auth.business_profile SET activation_enabled=true WHERE user_id=$1',[row.id]);
  }
  await db.query('COMMIT');
  console.log(JSON.stringify({accountVerified:true,preservedOrderPermission:true,passwordReady:row.password_ready,active:process.argv[2]==='--apply'||row.activation_enabled,rolesChanged:false}));
}catch(error){await db.query('ROLLBACK').catch(()=>{});const known=['PRESERVED_ACCOUNT_REQUIRED','PRESERVED_ORDER_PERMISSION_REQUIRED','PASSWORD_SETUP_REQUIRED'];console.error(known.includes(error.message)?error.message:'PROFILE_ACTIVATION_FAILED');process.exitCode=1;}
finally{await db.end();}
