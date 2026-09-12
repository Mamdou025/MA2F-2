import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareProduction } from '../server/productionPlan.ts';
const body={requestId:'0466b1a4-0c85-4bce-b158-4f3d64c4c729',netPacks:100};
const settings={sourceSha256:'a'.repeat(64),packsPerKg:'17'};
test('100 net packs are 3000 good sachets; source estimate remains exact',()=>{
  const result=prepareProduction(body,settings);
  assert.equal(result.saleableSachets,3000);
  assert.deepEqual(result.consumption,{method:'estimated_from_source_yield',packsPerKg:'17',
    sourceSha256:settings.sourceSha256,kgNumerator:'100',kgDenominator:'17'});
  assert.equal(result.businessWritesEnabled,false);
});
test('client cannot choose actor, yield, material consumption or subtract defects again',()=>{
  for(const field of ['actor','companyId','packsPerKg','consumedKg','rejectedSachets'])
    assert.throws(()=>prepareProduction({...body,[field]:1},settings));
  for(const netPacks of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'100'])
    assert.throws(()=>prepareProduction({...body,netPacks},settings));
});
test('missing or invalid source yield is not silently replaced with 17',()=>{
  for(const packsPerKg of ['', '0','0.0','-1','NaN','Infinity','1e3'])
    assert.throws(()=>prepareProduction(body,{...settings,packsPerKg}));
  assert.throws(()=>prepareProduction(body,{...settings,sourceSha256:''}));
  const result=prepareProduction(body,{...settings,packsPerKg:'16.5'});
  assert.equal(result.consumption.kgNumerator,'1000');
  assert.equal(result.consumption.kgDenominator,'165');
});
