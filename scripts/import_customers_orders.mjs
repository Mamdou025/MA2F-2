import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
if (!process.argv.includes('--apply')) throw new Error('APPLY_REQUIRED: use --apply for inactive candidate import');
const {Client}=createRequire('/home/runner/workspace/package.json')('pg');
const plan=JSON.parse(readFileSync('migration-private/customers-orders-plan.json','utf8'));
assert.equal(plan.activationAllowed,false);
const db=new Client({connectionString:process.env.DATABASE_URL});
try{
 await db.connect();await db.query('BEGIN');
 await db.query("SELECT pg_advisory_xact_lock(hashtext('ma2f-customer-order-model'))");
 const source=await db.query("SELECT status FROM ma2f_migration.source_runs WHERE archive_sha256=$1",[plan.archiveSha256]);
 assert.equal(source.rows[0]?.status,'verified');
 await db.query(readFileSync('deployment/customers-orders.sql','utf8'));
 await db.query('INSERT INTO ma2f_next.clients SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(id text,name text,customer_type text,zone text,phone text,price numeric,source_path text,payload jsonb) ON CONFLICT DO NOTHING',[plan.archiveSha256,JSON.stringify(plan.clients)]);
 await db.query('INSERT INTO ma2f_next.orders SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(id text,number text,order_date date,customer_id text,source_customer_id text,customer_link_state text,customer_name text,phone text,zone text,packs numeric,status text,source_path text,payload jsonb) ON CONFLICT DO NOTHING',[plan.archiveSha256,JSON.stringify(plan.orders)]);
 await db.query('INSERT INTO ma2f_next.customer_order_reviews(snapshot_sha256,review,summary) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[plan.archiveSha256,JSON.stringify(plan.review),JSON.stringify(plan.summary)]);
 for(const table of ['clients','orders']){
  const rows=(await db.query('SELECT * FROM ma2f_next.'+table+' WHERE snapshot_sha256=$1',[plan.archiveSha256])).rows;
  assert.equal(rows.length,plan[table].length);
  const expected=new Map(plan[table].map(x=>[x.id,x]));
  for(const row of rows){delete row.snapshot_sha256;if(table==='clients')row.price=Number(row.price);else{row.packs=Number(row.packs);row.order_date=row.order_date instanceof Date?row.order_date.toISOString().slice(0,10):row.order_date;}assert.deepEqual(row,expected.get(row.id));}
 }
 const review=(await db.query('SELECT review,summary,activation_allowed FROM ma2f_next.customer_order_reviews WHERE snapshot_sha256=$1',[plan.archiveSha256])).rows[0];
 assert.deepEqual(review.review,plan.review);assert.deepEqual(review.summary,plan.summary);assert.equal(review.activation_allowed,false);
 await db.query('COMMIT');console.log(JSON.stringify({status:'verified',...plan.summary,activationAllowed:false}));
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({status:'rolled_back',error:e.code||e.name}));process.exitCode=1;}finally{await db.end();}
