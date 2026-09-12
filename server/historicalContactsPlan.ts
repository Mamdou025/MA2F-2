import {stateHash} from './runtimeState';

export function planHistoricalContacts(state:Record<string,any>,sourceSha256:string){
 if(!/^[a-f0-9]{64}$/.test(sourceSha256)||!Array.isArray(state.clients)||!Array.isArray(state.ventes))throw new Error('INVALID_CONTACT_SOURCE');
 const seen=new Set<string>();const contacts:any[]=[];
 for(const c of state.clients){
  if(!c||typeof c.id!=='string'||!c.id||seen.has(c.id)||typeof c.nom!=='string'||!c.nom.trim()||
    (c.tel!==undefined&&c.tel!==null&&typeof c.tel!=='string'))throw new Error('CONTACT_SOURCE_REQUIRES_REVIEW');
  seen.add(c.id);contacts.push({key:'client:'+c.id,name:c.nom,phone:c.tel||false,historicalOnly:false,original:structuredClone(c)});
 }
 const knownNames=new Set(state.clients.map((c:any)=>c.nom));
 for(const sale of [...state.ventes,...(state.recouvrements||[])]){
  const name=sale?.client;
  if(typeof name!=='string'||!name.trim())throw new Error('SALE_CLIENT_NAME_REQUIRED');
  if(!knownNames.has(name)){contacts.push({key:'historical-name:'+name,name,phone:false,historicalOnly:true,original:{client:name,sourceSaleIds:state.ventes.filter((s:any)=>s?.client===name).map((s:any)=>s.id),sourcePaymentIds:(state.recouvrements||[]).filter((s:any)=>s?.client===name).map((s:any)=>s.id)}});knownNames.add(name);}
 }
 return {sourceSha256,contacts:contacts.map(c=>({...c,marker:'customer_'+stateHash(c.key),sourceHash:stateHash(c.original)})),
   currentClients:state.clients.length,historicalOnly:contacts.length-state.clients.length,businessWritesPerformed:0};
}
