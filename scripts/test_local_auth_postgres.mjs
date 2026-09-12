/** Commissioning fixture only; no real users, no public listener. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createLocalAuth } from '../server/localAuth.ts';
const config=process.env;
const handoff='/tmp/ma2f-auth-test-session.json';
const {auth,pool}=createLocalAuth(config);
const origin=config.MA2F_AUTH_ORIGIN;
const call=(path,body,cookie,requestOrigin=origin)=>auth.handler(new Request(origin+'/api/local-auth'+path,{
  method:body?'POST':'GET',headers:{origin:requestOrigin,...(body?{'content-type':'application/json'}:{}),
    ...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}));
let userId;
try {
  if(process.argv[2]==='--verify-session') {
    const {cookie,id}=JSON.parse(readFileSync(handoff,'utf8'));
    const response=await call('/get-session',null,cookie);
    assert.equal((await response.json()).user.id,id);
    console.log('SESSION_SURVIVED_NEW_PROCESS');
  } else {
    assert.equal(process.argv[2],'--run');
    const privileges=await pool.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    assert.ok(Object.values(privileges.rows[0]).every(x=>x===false));
    const other=await pool.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('ma2f_auth','pg_catalog','information_schema') AND (has_table_privilege(current_user,c.oid,'SELECT') OR has_table_privilege(current_user,c.oid,'INSERT'))");
    assert.equal(other.rowCount,0,'Auth role can access unrelated tables');
    const context=await auth.$context;
    const email='commissioning-'+randomBytes(8).toString('hex')+'@example.invalid';
    const password=randomBytes(32).toString('hex');
    const user=await context.internalAdapter.createUser({name:'MA2F temporary commissioning fixture',email,emailVerified:true});
    userId=user.id;
    await context.internalAdapter.createAccount({userId,providerId:'credential',accountId:userId,password:await context.password.hash(password)});
    assert.equal((await call('/sign-in/email',{email,password:'wrong-password'})).status,401);
    assert.equal((await call('/sign-in/email',{email,password},null,'https://untrusted.example.invalid')).status,403);
    const response=await call('/sign-in/email',{email,password});
    assert.equal(response.status,200);
    const cookies=response.headers.getSetCookie();
    assert.ok(cookies.some(c=>c.includes('session_token=') && /HttpOnly/i.test(c) && /Secure/i.test(c)));
    const cookie=cookies.map(c=>c.split(';')[0]).join('; ');
    writeFileSync(handoff,JSON.stringify({cookie,id:userId}),{mode:0o600,flag:'wx'});
    const child=spawnSync(process.execPath,['--import','tsx',import.meta.filename,'--verify-session'],{encoding:'utf8',timeout:60000});
    assert.equal(child.status,0,'Session did not survive a new process');
    assert.match(child.stdout,/SESSION_SURVIVED_NEW_PROCESS/);
    assert.equal((await call('/sign-out',{},cookie)).status,200);
    assert.equal(await (await call('/get-session',null,cookie)).json(),null);
    console.log(JSON.stringify({status:'passed',database:'production_postgresql',checks:['restricted_role','password_check','origin_check','secure_cookie','session_new_process','logout_revocation'],realUsersChanged:false}));
  }
} catch {
  console.error('POSTGRES_AUTH_TEST_FAILED'); process.exitCode=1;
} finally {
  if(userId) {
    await pool.query('DELETE FROM ma2f_auth."user" WHERE id=$1',[userId]);
    const result=await pool.query('SELECT count(*) AS n FROM ma2f_auth."session" WHERE "userId"=$1',[userId]);
    assert.equal(result.rows[0].n,'0');
    try {unlinkSync(handoff);}catch{}
    console.log('TEST_ACCOUNT_AND_SESSIONS_REMOVED');
  }
  await pool.end();
}
