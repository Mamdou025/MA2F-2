import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
if (!process.argv.includes('--apply')) throw new Error('APPLY_REQUIRED: use --apply for inactive candidate import');
const {Client}=createRequire('/home/runner/workspace/package.json')('pg');
const r=JSON.parse(readFileSync('migration-private/finance-stock-review-v2.json','utf8'));
assert.equal(r.activationAllowed,false);
const db=new Client({connectionString:process.env.DATABASE_URL});
const analyses=new Map(r.saleAnalysis.map(a=>[a.id,a]));
const saleIds=new Set(r.records.ventes.map(v=>v.id));
const rows={
 sales:r.records.ventes.map(v=>{const a=analyses.get(v.id);return {id:v.id,number:v.numero??null,sale_date:v.date,customer_name:v.client,packs:String(v.packs),unit_price:String(v.prix),mode:v.mode,initial_cash_legacy:a.legacyCashAtSale,linked_recoveries:a.linkedRecoveries,balance_legacy:a.legacyBalance,payload:v};}),
 recoveries:r.records.recouvrements.map(v=>({id:v.id,payment_date:v.date,amount:String(v.montant),sale_id:saleIds.has(v.venteId)?v.venteId:null,source_sale_id:v.venteId??null,link_state:saleIds.has(v.venteId)?'resolved':'unresolved',payload:v})),
 stock_movements:r.records.mouvements_stock.map(v=>({id:v.id,movement_date:v.date,movement_type:v.type,product:v.produit??null,quantity:String(v.quantite),unit:v.unite??null,source_place:v.emplacementSource??null,destination_place:v.emplacementDest??null,review_required:!v.unite||(!v.emplacementSource&&!v.emplacementDest),payload:v})),
 production_batches:r.records.production.map(v=>({id:v.id,production_date:v.date,packs:String(v.packs),payload:v}))
};
const defs={sales:'id text,number text,sale_date date,customer_name text,packs numeric,unit_price numeric,mode text,initial_cash_legacy numeric,linked_recoveries numeric,balance_legacy numeric,payload jsonb',recoveries:'id text,payment_date date,amount numeric,sale_id text,source_sale_id text,link_state text,payload jsonb',stock_movements:'id text,movement_date date,movement_type text,product text,quantity numeric,unit text,source_place text,destination_place text,review_required boolean,payload jsonb',production_batches:'id text,production_date date,packs numeric,payload jsonb'};
try{
 await db.connect();await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('ma2f-finance-stock'))");
 const status=await db.query('SELECT status FROM ma2f_migration.source_runs WHERE archive_sha256=$1',[r.sourceSha256]);assert.equal(status.rows[0]?.status,'verified');
 await db.query(readFileSync('deployment/finance-stock.sql','utf8'));
 for(const [table,items] of Object.entries(rows)){
  assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  await db.query('INSERT INTO ma2f_next.'+table+' SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x('+defs[table]+') ON CONFLICT DO NOTHING',[r.sourceSha256,JSON.stringify(items)]);
  const back=(await db.query('SELECT * FROM ma2f_next.'+table+' WHERE snapshot_sha256=$1',[r.sourceSha256])).rows;assert.equal(back.length,items.length);
  const expected=new Map(items.map(i=>[i.id,i]));
  for(const row of back){delete row.snapshot_sha256;for(const key of Object.keys(row))if(row[key] instanceof Date)row[key]=row[key].toISOString().slice(0,10);assert.deepEqual(row,expected.get(row.id));}
 }
 const {records,...review}=r;
 await db.query('INSERT INTO ma2f_next.finance_stock_reviews(snapshot_sha256,report) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.sourceSha256,JSON.stringify(review)]);
 const back=(await db.query('SELECT report,activation_allowed FROM ma2f_next.finance_stock_reviews WHERE snapshot_sha256=$1',[r.sourceSha256])).rows[0];assert.deepEqual(back.report,review);assert.equal(back.activation_allowed,false);
 await db.query('COMMIT');console.log(JSON.stringify({status:'verified',counts:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length])),issues:r.summary.issueCounts,activationAllowed:false}));
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({status:'rolled_back',code:e.code||e.name,table:e.table,column:e.column}));process.exitCode=1;}finally{await db.end();}
