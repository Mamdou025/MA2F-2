import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {computeSoldeCaisseAuDate} from '../client/src/lib/helpers.ts';
const r=JSON.parse(readFileSync('migration-private/cash-review.json','utf8'));
for(const [source,opening] of Object.entries(r.openingBySource)) {
 const db={...r.legacyDatabase,params:{...r.legacyDatabase.params,soldeOuverture:opening}};
 assert.ok(Math.abs(computeSoldeCaisseAuDate(db)-Number(r.balanceScenarios[source]))<1e-8);
}
// Exercise date boundaries and historical fallback expense deduplication.
const fixture={ventes:[],recouvrements:[],params:{soldeOuverture:100},apports:[{date:'2026-01-01',montant:50}],depenses:[{date:'2026-01-02',montant:10,categorie:'Carburant véhicule'}],versements:[{date:'2026-01-03',montant:20}],vehiculeOps:[{date:'2026-01-02',montant:10,type:'Carburant'}],maintenance:[{date:'2026-01-02',cout:5}]};
assert.equal(computeSoldeCaisseAuDate(fixture,'2026-01-01'),150);
assert.equal(computeSoldeCaisseAuDate(fixture,'2026-01-02'),135);
assert.equal(computeSoldeCaisseAuDate(fixture),115);
console.log(JSON.stringify({status:'cash_parity_passed',scenarios:r.balanceScenarios,totals:r.totals,events:r.events.length,missingModes:r.issues.length}));
