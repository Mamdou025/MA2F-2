import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createClerkClient } from '@clerk/express';
const apply = process.argv.includes('--apply');
const source = 'migration-private/step1-admin-confirmed.json';
const raw = readFileSync(source);
const bundle = JSON.parse(raw);
const validation = JSON.parse(readFileSync('migration-private/step2-validation.json','utf8'));
function must(ok, code) { if (!ok) throw new Error(code); }
must(validation.status === 'reconciled' && validation.accounts.length === 5, 'VALIDATION_REQUIRED');
const key = process.env.CLERK_SECRET_KEY;
must(key?.startsWith('sk_test_'), 'DEVELOPMENT_TENANT_REQUIRED');
const tenant = createHash('sha256').update(process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || key).digest('hex');
const client = createClerkClient({secretKey:key});
const contract = bundle.contract;
must(contract.users.length === 5 && bundle.quarantine.length === 1 && !bundle.readyForCutover, 'COVERAGE_MISMATCH');
const jobs = contract.users.map(profile => {
 const link=contract.links.find(x=>x.appUserId===profile.id);
 must(link?.reviewed === true,'UNREVIEWED_LINK');
 const identity=contract.identities.find(x=>x.uid===link.firebaseUid);
 const evidence=bundle.provenance.find(x=>x.firebaseUid===link.firebaseUid);
 const checked=validation.accounts.find(x=>x.firebaseUid===link.firebaseUid);
 must(isDeepStrictEqual(checked?.profile,profile),'VALIDATION_PROFILE_MISMATCH');
 must(identity && evidence && identity.email===profile.email,'SOURCE_MISMATCH');
 must(typeof evidence.emailVerified==='boolean','VERIFICATION_STATE_REQUIRED');
 return {profile,identity,evidence,externalId:'firebase:ma2f-aquasachet:'+identity.uid};
});
must(new Set(jobs.map(j=>j.externalId)).size===5,'DUPLICATE_LINK');
const lockPath='migration-private/clerk-development-import.lock';
let lock;
try {
 lock=openSync(lockPath,'wx',0o600);
 let existing=[];
 for(let offset=0;;offset+=100){
  const page=await client.users.getUserList({limit:100,offset});
  existing.push(...page.data);
  if(existing.length>=page.totalCount) break;
  must(page.data.length>0,'PAGINATION_FAILED');
 }
 const metadataFor=j=>({ma2fMigration:{version:1,project:'ma2f-aquasachet',firebaseUid:j.identity.uid,sourceSha256:bundle.sourceSha256,profile:j.profile,sourceEmailVerified:j.evidence.emailVerified,activationAllowed:false,directOdooAccess:false}});
 const verify=(u,j)=>{
  must(u.externalId===j.externalId,'EXTERNAL_ID_MISMATCH');
  must(isDeepStrictEqual(u.privateMetadata,metadataFor(j)),'METADATA_MISMATCH');
  must(Object.keys(u.publicMetadata||{}).length===0 && Object.keys(u.unsafeMetadata||{}).length===0,'UNEXPECTED_PUBLIC_GRANTS');
  must(u.banned===j.identity.disabled,'ACTIVE_STATE_MISMATCH');
  must(u.emailAddresses.length===1 && u.emailAddresses[0].emailAddress===j.identity.email,'EMAIL_MISMATCH');
  must((u.emailAddresses[0].verification?.status==='verified')===j.evidence.emailVerified,'EMAIL_VERIFICATION_MISMATCH');
 };
 for(const j of jobs){
  const byId=existing.filter(u=>u.externalId===j.externalId);
  must(byId.length<=1,'DUPLICATE_EXTERNAL_ID');
  const collisions=existing.filter(u=>u.emailAddresses.some(e=>e.emailAddress.toLowerCase()===j.identity.email.toLowerCase()) && u.externalId!==j.externalId);
  must(collisions.length===0,'EMAIL_ALREADY_OWNED_BY_DIFFERENT_IDENTITY');
  if(byId.length) verify(byId[0],j);
 }
 console.log(JSON.stringify({phase:'preflight',environment:'development',candidates:jobs.length,existing:existing.filter(u=>jobs.some(j=>j.externalId===u.externalId)).length,apply}));
 if(apply){
  const receipt={environment:'development',tenantFingerprint:tenant,sourceFileSha256:createHash('sha256').update(raw).digest('hex'),sourceSha256:bundle.sourceSha256,createdUtc:new Date().toISOString(),readyForCutover:false,quarantined:1,accounts:[]};
  const receiptPath='migration-private/clerk-development-receipt-'+Date.now()+'.json';
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  for(const j of jobs){
   let u=existing.find(u=>u.externalId===j.externalId);
   const reused=Boolean(u);
   if(!u) u=await client.users.createUser({externalId:j.externalId,emailAddress:[j.identity.email],emailAddressIdentificationStatus:[j.evidence.emailVerified?'verified':'reserved'],skipPasswordRequirement:true,banned:j.identity.disabled,privateMetadata:metadataFor(j)});
   receipt.accounts.push({appUserId:j.profile.id,firebaseUid:j.identity.uid,clerkUserId:u.id,reused,verified:false});
   writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});
   const readback=await client.users.getUser(u.id);
   verify(readback,j);
   receipt.accounts.at(-1).verified=true;
   writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});
   console.log(JSON.stringify({phase:'verified',number:receipt.accounts.length,reused}));
  }
  console.log(JSON.stringify({phase:'complete',environment:'development',verified:receipt.accounts.length,receipt:receiptPath,businessAccess:false}));
 }
} catch(e) {
 console.error(JSON.stringify({phase:'failed',code:e.errors?.map(x=>x.code)||e.message,status:e.status||null}));
 process.exitCode=1;
} finally {
 if(lock!==undefined){closeSync(lock);unlinkSync(lockPath);}
}
