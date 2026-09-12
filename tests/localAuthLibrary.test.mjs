import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { localAuthOptions } from '../server/localAuth.ts';

test('library verifies password, enforces origin, persists and revokes session; public signup stays closed', async () => {
  // Actual library/hash/session behaviour with its test adapter; not a PostgreSQL test.
  const store={user:[],session:[],account:[],verification:[],rateLimit:[]};
  const origin='https://ma2f.example.invalid';
  const options=localAuthOptions({origin,secret:'fictitious-secret-for-tests-only-123456789',database:''},memoryAdapter(store));
  const auth=betterAuth(options);
  const context=await auth.$context;
  const user=await context.internalAdapter.createUser({name:'Fictitious test user',email:'local@example.invalid',emailVerified:true});
  const password='Fictitious-Strong-Password-42!';
  await context.internalAdapter.createAccount({userId:user.id,providerId:'credential',accountId:user.id,
    password:await context.password.hash(password)});
  assert.notEqual(store.account[0].password,password);
  const request=(path,body,cookie,requestOrigin=origin)=>auth.handler(new Request(origin+'/api/local-auth'+path,{
    method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),
      origin:requestOrigin,...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await request('/sign-up/email',{name:'Uninvited',email:'other@example.invalid',password})).status,400);
  assert.equal(store.user.length,1);
  assert.equal((await request('/sign-in/email',{email:user.email,password:'Incorrect-password-42!'})).status,401);
  assert.equal((await request('/sign-in/email',{email:user.email,password},undefined,'https://attacker.example.invalid')).status,403);
  const login=await request('/sign-in/email',{email:user.email,password});
  assert.equal(login.status,200);
  const cookies=login.headers.getSetCookie();
  const sessionCookie=cookies.find(value=>value.startsWith('__Secure-ma2f.session_token='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie,/HttpOnly/i); assert.match(sessionCookie,/Secure/i); assert.match(sessionCookie,/SameSite=Lax/i);
  const cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  assert.equal(store.session.length,1);
  assert.equal((await (await request('/get-session',null,cookie)).json()).user.id,user.id);
  assert.equal((await request('/sign-out',{},cookie)).status,200);
  assert.equal(store.session.length,0);
  assert.equal(await (await request('/get-session',null,cookie)).json(),null);
});
