import {test} from 'node:test';import assert from 'node:assert/strict';
import {planHistoricalContacts} from '../server/historicalContactsPlan.ts';
test('historical-only names are preserved exactly and never merged by case',()=>{
 const state={clients:[{id:'a',nom:'Original',tel:'123',legacy:-1}],ventes:[{id:'s1',client:'Former'},{id:'s2',client:'Former'},{id:'s3',client:'former'}]};
 const copy=structuredClone(state),a=planHistoricalContacts(state,'a'.repeat(64)),b=planHistoricalContacts(state,'b'.repeat(64));
 assert.equal(a.contacts.length,3);assert.equal(a.historicalOnly,2);assert.deepEqual(state,copy);assert.deepEqual(a.contacts.map(c=>c.marker),b.contacts.map(c=>c.marker));assert.deepEqual(a.contacts[1].original.sourceSaleIds,['s1','s2']);assert.equal(a.contacts[1].phone,false);
});
test('duplicate source identities are refused rather than combined',()=>{
 assert.throws(()=>planHistoricalContacts({clients:[{id:'a',nom:'A'},{id:'a',nom:'B'}],ventes:[]},'a'.repeat(64)),/REQUIRES_REVIEW/);
});
