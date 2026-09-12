import {test} from 'node:test';import assert from 'node:assert/strict';
import {planHistoricalSales} from '../server/historicalSalesPlan.ts';
const sale={id:'s1',client:'Client Original',date:'2026-01-01',packs:100,prix:600,mode:'Crédit',avance:10000};
const fixture={ventes:[sale],clients:[{id:'c1',nom:'Client Original'}],recouvrements:[{id:'p1',venteId:'s1',montant:5000}]};
test('historic plan preserves records and uses stable source keys across snapshots',()=>{
 const source=structuredClone(fixture);const a=planHistoricalSales(source,'a'.repeat(64)),b=planHistoricalSales(source,'b'.repeat(64));
 assert.deepEqual(source,fixture);assert.equal(a.rows[0].externalKey,b.rows[0].externalKey);assert.deepEqual(a.rows[0].original,sale);assert.equal(a.rows[0].status,'awaiting_accounting_mapping');assert.equal(a.businessWritesPerformed,0);
});
test('ambiguous identities, impossible dates and overpayments stay uncorrected for review',()=>{
 const s={ventes:[{...sale,date:'2026-02-30'},sale],clients:[],recouvrements:[{venteId:'s1',montant:999999},{venteId:'missing',montant:50}]};
 const copy=structuredClone(s),p=planHistoricalSales(s,'a'.repeat(64));assert.deepEqual(s,copy);assert.equal(p.summary.requiresSourceReview,2);assert.equal(p.summary.unmatchedPayments,1);assert.ok(p.rows[0].reasons.includes('invalid_sale_date'));assert.ok(p.rows[0].reasons.includes('payments_exceed_sale_total'));assert.ok(p.rows[0].reasons.includes('duplicate_sale_id'));
});

test('free receipts remain unallocated and are not classified as broken references',()=>{const p=planHistoricalSales({...fixture,recouvrements:[{id:'free',venteId:'',client:'Original',montant:25}]},'a'.repeat(64));assert.equal(p.summary.freeReceipts,1);assert.equal(p.summary.unmatchedPayments,0);assert.equal(p.freeReceipts[0].venteId,'');});
