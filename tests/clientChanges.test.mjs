import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateClientChanges} from '../server/clientChanges.ts';
import {resolveLocalProfile} from '../server/localProfile.ts';
const client={id:'source_a',nom:'Original',type:'Boutique',zone:'Dakar',tel:'',prix:600,legacyFlag:'preserve'};
const state={clients:[client],ventes:[],commandes:[],recouvrements:[],params:{anomaly:-7}};
function profile(role='admin',permissions){return resolveLocalProfile({id:'native',emailVerified:true,email:'x@example.invalid'}, {user_id:'native',source_uid:'source',source_sha256:'a'.repeat(64),activation_enabled:true,source_disabled:false,profile:{id:'business',role,roles:[role],actif:true,...(permissions?{permissions}: {})}});}
const changes=rows=>[{field:'clients',beforeHash:'a'.repeat(64),value:rows}];
test('client edits preserve unknown source values and reject unauthorized corrections',()=>{
 const edited={...client,nom:'Updated'};validateClientChanges(profile(),state,changes([edited]));
 assert.deepEqual(state.clients,[client]);
 for(const row of [{...edited,legacyFlag:'changed'},Object.fromEntries(Object.entries(edited).filter(([k])=>k!=='legacyFlag'))]) assert.throws(()=>validateClientChanges(profile(),state,changes([row])),/SOURCE_FIELD_CHANGE/);
});
test('custom permissions, inactive access and protected financial fields cannot be bypassed',()=>{
 for(const p of [profile('lecteur'),profile('commercial',{clients:['read']}),{...profile(),businessAccess:false}])assert.throws(()=>validateClientChanges(p,state,changes([{...client,nom:'Changed'}])),/PERMISSION/);
 assert.throws(()=>validateClientChanges(profile(),state,[{field:'ventes',value:[],beforeHash:'a'.repeat(64)}]),/BUSINESS_COMMAND_REQUIRED/);
});
test('referenced clients and duplicate identifiers cannot be removed or ambiguously changed',()=>{
 assert.throws(()=>validateClientChanges(profile('commercial'),state,changes([])),/PERMISSION/);
 assert.throws(()=>validateClientChanges(profile(),{...state,ventes:[{client:'source_a'}]},changes([])),/BUSINESS_REFERENCES/);
 assert.throws(()=>validateClientChanges(profile(),{...state,ventes:[{client:'Original'}]},changes([{...client,nom:'Renamed'}])),/CLIENT_RENAME_REQUIRES_REFERENCE_MIGRATION/);
 assert.throws(()=>validateClientChanges(profile(),state,changes([client,client])),/AMBIGUOUS/);
 for(const prix of [-1,Infinity,NaN,50001])assert.throws(()=>validateClientChanges(profile(),state,changes([{...client,prix}])),/INVALID_CLIENT|INVALID_JSON_VALUE/);
});
