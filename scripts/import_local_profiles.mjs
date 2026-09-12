import pg from 'pg';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.argv[2]!=='--apply'||process.argv.length!==3){console.error('Explicit --apply required');process.exit(2);}
const raw=readFileSync('migration-private/step1-admin-confirmed.json');
const source=JSON.parse(raw);
const validation=JSON.parse(readFileSync('migration-private/step2-validation.json','utf8'));
assert.equal(validation.status,'reconciled');
assert.equal(source.contract.users.length,5); assert.equal(source.quarantine.length,1);
assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);
const sourceFileSha=createHash('sha256').update(raw).digest('hex');
const jobs=source.contract.users.map(profile=>{
  const link=source.contract.links.find(x=>x.appUserId===profile.id);
  assert.equal(link?.reviewed,true);
  const identity=source.contract.identities.find(x=>x.uid===link.firebaseUid);
  const evidence=source.provenance.find(x=>x.firebaseUid===link.firebaseUid);
  assert.deepEqual(validation.accounts.find(x=>x.firebaseUid===link.firebaseUid)?.profile,profile);
  assert.equal(identity.email,profile.email);
  assert.equal(typeof identity.disabled,'boolean'); assert.equal(typeof evidence.emailVerified,'boolean');
  return {id:'legacy_'+createHash('sha256').update(identity.uid).digest('hex').slice(0,32),profile,identity,evidence};
});
assert.equal(new Set(jobs.map(x=>x.profile.email.toLowerCase())).size,5);
const u=new URL(readFileSync('/tmp/ma2f-auth-provision-uri','utf8'));u.search='';
assert.equal(u.hostname,'ep-falling-morning-adxx90io.c-2.us-east-1.aws.neon.tech');assert.equal(u.pathname,'/neondb');
const db=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true}});
try{
  await db.connect(); await db.query('BEGIN');
  await db.query(`CREATE TABLE IF NOT EXISTS ma2f_auth.business_profile (
    user_id text PRIMARY KEY REFERENCES ma2f_auth."user"(id),source_uid text UNIQUE NOT NULL,
    source_sha256 text NOT NULL,source_file_sha256 text NOT NULL,profile jsonb NOT NULL,
    source_disabled boolean NOT NULL,activation_enabled boolean NOT NULL DEFAULT false)`);
  await db.query(`CREATE TABLE IF NOT EXISTS ma2f_auth.migration_quarantine (
    source_file_sha256 text PRIMARY KEY,payload jsonb NOT NULL)`);
  await db.query('REVOKE ALL ON ma2f_auth.business_profile,ma2f_auth.migration_quarantine FROM PUBLIC,ma2f_auth_runtime');
  await db.query('GRANT SELECT ON ma2f_auth.business_profile TO ma2f_auth_runtime');
  for(const j of jobs){
    await db.query(`INSERT INTO ma2f_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt")
      VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(id) DO NOTHING`,[j.id,j.profile.nom,j.profile.email,j.evidence.emailVerified]);
    const user=(await db.query('SELECT name,email,"emailVerified" FROM ma2f_auth."user" WHERE id=$1',[j.id])).rows[0];
    assert.deepEqual(user,{name:j.profile.nom,email:j.profile.email,emailVerified:j.evidence.emailVerified});
    await db.query(`INSERT INTO ma2f_auth.business_profile(user_id,source_uid,source_sha256,source_file_sha256,profile,source_disabled)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO NOTHING`,[j.id,j.identity.uid,source.sourceSha256,sourceFileSha,j.profile,j.identity.disabled]);
    const row=(await db.query('SELECT * FROM ma2f_auth.business_profile WHERE user_id=$1',[j.id])).rows[0];
    assert.deepEqual(row,{user_id:j.id,source_uid:j.identity.uid,source_sha256:source.sourceSha256,source_file_sha256:sourceFileSha,
      profile:j.profile,source_disabled:j.identity.disabled,activation_enabled:false});
  }
  await db.query('INSERT INTO ma2f_auth.migration_quarantine VALUES($1,$2) ON CONFLICT DO NOTHING',[sourceFileSha,JSON.stringify(source.quarantine)]);
  assert.deepEqual((await db.query('SELECT payload FROM ma2f_auth.migration_quarantine WHERE source_file_sha256=$1',[sourceFileSha])).rows[0].payload,source.quarantine);
  await db.query('COMMIT');
  console.log(JSON.stringify({status:'profiles_preserved',profiles:jobs.length,quarantined:source.quarantine.length,
    sourceFileSha256:sourceFileSha,businessAccess:false,passwordsImported:0}));
}catch{await db.query('ROLLBACK').catch(()=>{});console.error('PROFILE_IMPORT_FAILED_ROLLED_BACK');process.exitCode=1;}
finally{await db.end();}
