import type { LocalProfile } from './localProfile';
import { canLocalAction } from './localProfile';
import { stateHash, type StateChange } from './runtimeState';

/** Validate client records independently of the browser. Other business fields are closed. */
export function validateClientChanges(profile: LocalProfile, state: Record<string,unknown>, changes: StateChange[]) {
  if(changes.length!==1 || changes[0].field!=='clients') throw new Error('BUSINESS_COMMAND_REQUIRED');
  const before=state.clients,after=changes[0].value;
  if(!Array.isArray(before)||!Array.isArray(after)||after.length>100000) throw new Error('INVALID_CLIENTS');
  const index=(rows:any[])=>{
    const map=new Map<string,any>();
    for(const row of rows){if(!row || typeof row.id!=='string' || !row.id || map.has(row.id)) throw new Error('AMBIGUOUS_CLIENT_ID');map.set(row.id,row);}
    return map;
  };
  const old=index(before),next=index(after);
  const known=new Set(['id','nom','type','zone','tel','prix','lat','lng','plafondCredit','bonusExceptionnel']);
  let count=0;
  for(const [id,row] of Array.from(next)){
    const prior=old.get(id);if(prior && stateHash(prior)===stateHash(row))continue;
    count++;
    if(!canLocalAction(profile,'clients',prior?'edit':'create'))throw new Error('BUSINESS_PERMISSION_REQUIRED');
    if(prior && prior.nom!==row.nom && ['ventes','commandes','recouvrements'].some(field=>Array.isArray(state[field]) && (state[field] as any[]).some(r=>r?.client===prior.nom)))throw new Error('CLIENT_RENAME_REQUIRES_REFERENCE_MIGRATION');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !row.nom || typeof row.nom!=='string' || row.nom.trim().length===0 || row.nom.length>500 ||
      !['type','zone','tel'].every(k=>typeof row[k]==='string' && row[k].length<=500) ||
      typeof row.prix!=='number' || !Number.isFinite(row.prix) || row.prix<0 || row.prix>50000)throw new Error('INVALID_CLIENT');
    if(row.lat!==undefined && (typeof row.lat!=='number'||!Number.isFinite(row.lat)||Math.abs(row.lat)>90))throw new Error('INVALID_CLIENT');
    if(row.lng!==undefined && (typeof row.lng!=='number'||!Number.isFinite(row.lng)||Math.abs(row.lng)>180))throw new Error('INVALID_CLIENT');
    if(row.plafondCredit!==undefined && (typeof row.plafondCredit!=='number'||!Number.isFinite(row.plafondCredit)||row.plafondCredit<0))throw new Error('INVALID_CLIENT');
    if(row.bonusExceptionnel!==undefined){const b=row.bonusExceptionnel;if(!b||!Number.isSafeInteger(b.seuil)||b.seuil<=0||!Number.isSafeInteger(b.packsBonus)||b.packsBonus<0||Object.keys(b).some(k=>!['seuil','packsBonus'].includes(k)))throw new Error('INVALID_CLIENT');}
    // Preserve unknown source fields unchanged; no silent repair or removal.
    for(const k of Array.from(new Set([...Object.keys(prior||{}),...Object.keys(row)])))if(!known.has(k)){
      if(!prior||!Object.hasOwn(prior,k)||!Object.hasOwn(row,k)||stateHash(prior[k])!==stateHash(row[k]))throw new Error('SOURCE_FIELD_CHANGE_REQUIRES_REVIEW');
    }
  }
  for(const [id] of Array.from(old))if(!next.has(id)){
    count++;if(!profile.roles.includes('admin')||!canLocalAction(profile,'clients','delete'))throw new Error('BUSINESS_PERMISSION_REQUIRED');
    for(const field of ['ventes','commandes','recouvrements']){
      const rows=state[field];if(!Array.isArray(rows))throw new Error('CLIENT_REFERENCES_UNAVAILABLE');
      if(rows.some(r=>r?.client===id || r?.clientId===id || r?.client===old.get(id).nom))throw new Error('CLIENT_HAS_BUSINESS_REFERENCES');
    }
  }
  if(!count || count>100)throw new Error('INVALID_CLIENT_CHANGE_COUNT');
}
