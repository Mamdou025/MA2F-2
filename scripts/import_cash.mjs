import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
if (!process.argv.includes('--apply')) throw new Error('APPLY_REQUIRED: use --apply for inactive candidate import');
const {Client}=createRequire('/home/runner/workspace/package.json')('pg');
const report=JSON.parse(readFileSync('migration-private/cash-review.json','utf8'));
assert.equal(report.sourceSha256,'82afd0419934a23a5d48ccd31615347ac5c1655ff93063ef6b19ff7b440cb548');
assert.equal(report.activationAllowed,false);
const db=new Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
 await db.query('BEGIN');
 await db.query("SELECT pg_advisory_xact_lock(hashtext('ma2f-cash-candidates'))");
 assert.equal((await db.query('SELECT status FROM ma2f_migration.source_runs WHERE archive_sha256=$1',[report.sourceSha256])).rows[0]?.status,'verified');
 await db.query(readFileSync('deployment/cash.sql','utf8'));
 for(const e of report.events) await db.query('INSERT INTO ma2f_next.cash_events VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[report.sourceSha256,e.kind,e.id,e.date,e.amount,e.direction,e.mode,JSON.stringify(e.payload)]);
 const actual=(await db.query("SELECT kind,id,to_char(event_date,'YYYY-MM-DD') AS date,amount::text, direction,mode,payload FROM ma2f_next.cash_events WHERE snapshot_sha256=$1 ORDER BY kind,id",[report.sourceSha256])).rows;
 const expected=report.events.map(e=>({...e})).sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:a.id<b.id?-1:a.id>b.id?1:0);
 assert.deepEqual(actual,expected);
 await db.query('INSERT INTO ma2f_next.cash_reviews VALUES ($1,$2,false) ON CONFLICT DO NOTHING',[report.sourceSha256,JSON.stringify(report)]);
 const review=(await db.query('SELECT report,activation_allowed FROM ma2f_next.cash_reviews WHERE snapshot_sha256=$1',[report.sourceSha256])).rows[0];
 assert.deepEqual(review.report,report); assert.equal(review.activation_allowed,false);
 await db.query('COMMIT');
 console.log(JSON.stringify({status:'cash_import_verified',rows:actual.length,activationAllowed:false}));
} catch(e) {await db.query('ROLLBACK'); console.error(e); process.exitCode=1;} finally {await db.end();}
