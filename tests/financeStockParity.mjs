import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {cashAtSale,resteVente} from '../client/src/lib/helpers.ts';
import {calculerStockParEmplacement} from '../client/src/lib/stock.ts';
const r=JSON.parse(readFileSync('migration-private/finance-stock-review-v2.json','utf8'));
const db={recouvrements:r.records.recouvrements};
const analysis=new Map(r.saleAnalysis.map(a=>[a.id,a]));
for(const sale of r.records.ventes){const a=analysis.get(sale.id);assert.equal(cashAtSale(sale,db),Number(a.legacyCashAtSale));assert.equal(resteVente(sale,db),Number(a.legacyBalance));}
const stocks=calculerStockParEmplacement(r.records.mouvements_stock);
const nonzero=r.stockPositions.filter(p=>Number(p.quantity)!==0);
assert.equal(stocks.length,nonzero.length);
for(const p of nonzero){const old=stocks.find(s=>s.emplacement===p.place&&s.produit===p.product&&s.unite===p.unit);assert.ok(old);assert.ok(Math.abs(old.quantite-Number(p.quantity))<1e-8);}
assert.equal(r.activationAllowed,false);
console.log(JSON.stringify({status:'legacy_parity_verified',sales:r.records.ventes.length,stockPositions:stocks.length,stockIncomplete:r.summary.issueCounts.MISSING_STOCK_ENDPOINTS||0}));
