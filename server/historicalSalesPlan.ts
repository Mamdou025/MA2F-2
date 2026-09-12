import {stateHash} from './runtimeState';

/** Plan only. Never infer missing money, taxes, contacts or movements from today's defaults. */
export function planHistoricalSales(state:Record<string,any>,sourceSha256:string){
 if(!/^[a-f0-9]{64}$/.test(sourceSha256)||!Array.isArray(state.ventes)||!Array.isArray(state.clients)||!Array.isArray(state.recouvrements))throw new Error('INVALID_HISTORY_SOURCE');
 const counts=new Map<string,number>();for(const v of state.ventes)if(typeof v?.id==='string')counts.set(v.id,(counts.get(v.id)||0)+1);
 const reasonCounts:Record<string,number>={};
 const rows=state.ventes.map((sale:any,index:number)=>{
  const reasons:string[]=[];
  if(typeof sale?.id!=='string'||!sale.id)reasons.push('missing_sale_id');
  else if(counts.get(sale.id)!==1)reasons.push('duplicate_sale_id');
  // Existing MA2F sales store the exact client name, not the client document id.
  const client=typeof sale?.client==='string'&&sale.client?state.clients.filter((c:any)=>c?.nom===sale.client):[];
  if(client.length!==1)reasons.push(client.length?'ambiguous_client':'unresolved_client');
  if(typeof sale?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(sale.date)||!Number.isFinite(Date.parse(sale.date+'T00:00:00Z'))||new Date(sale.date+'T00:00:00Z').toISOString().slice(0,10)!==sale.date)reasons.push('invalid_sale_date');
  if(!Number.isSafeInteger(sale?.packs)||sale.packs<=0)reasons.push('invalid_pack_quantity');
  if(!Number.isSafeInteger(sale?.prix)||sale.prix<=0)reasons.push('invalid_unit_price');
  const total=Number.isSafeInteger(sale?.packs)&&Number.isSafeInteger(sale?.prix)?sale.packs*sale.prix:null;
  if(total!==null&&!Number.isSafeInteger(total))reasons.push('unsafe_total');
  if(!['Payé','Crédit'].includes(sale?.mode))reasons.push('unknown_payment_mode');
  if(sale?.avance!==undefined&&(!Number.isSafeInteger(sale.avance)||sale.avance<0||(total!==null&&sale.avance>total)))reasons.push('invalid_advance');
  const payments=typeof sale?.id==='string'?state.recouvrements.filter((p:any)=>p.venteId===sale.id):[];
  if(payments.some((p:any)=>!Number.isSafeInteger(p.montant)||p.montant<=0))reasons.push('invalid_linked_payment');
  const collected=payments.reduce((sum:number,p:any)=>sum+(Number.isSafeInteger(p.montant)?p.montant:0),0)+(Number.isSafeInteger(sale?.avance)?sale.avance:0);
  if(!Number.isSafeInteger(collected)||(total!==null&&collected>total))reasons.push('payments_exceed_sale_total');
  // No assumption about payment journal, VAT, bonus policy or historic stock deductions.
  reasons.forEach(r=>reasonCounts[r]=(reasonCounts[r]||0)+1);
  return {sourceIndex:index,sourceId:sale?.id??null,externalKey:typeof sale?.id==='string'&&sale.id?'ma2f:ventes:'+sale.id:null,
    sourceSha256,resolvedClientId:client.length===1?client[0].id:null,sourceHash:stateHash(sale),original:structuredClone(sale),linkedPayments:structuredClone(payments),
    status:reasons.length?'requires_source_review':'awaiting_accounting_mapping',reasons};
 });
 const ids=new Set(state.ventes.map((v:any)=>v?.id).filter((id:any)=>typeof id==='string'&&id));
 const freeReceipts=state.recouvrements.filter((p:any)=>p?.venteId===''||p?.venteId==null);
 const unmatchedPayments=state.recouvrements.filter((p:any)=>p?.venteId!==''&&p?.venteId!=null&&!ids.has(p.venteId));
 return {sourceSha256,rows,freeReceipts:structuredClone(freeReceipts),unmatchedPayments:structuredClone(unmatchedPayments),summary:{sales:rows.length,
   requiresSourceReview:rows.filter((r:any)=>r.reasons.length).length,awaitingAccountingMapping:rows.filter((r:any)=>!r.reasons.length).length,
   freeReceipts:freeReceipts.length,unmatchedPayments:unmatchedPayments.length,reasonCounts},businessWritesPerformed:0};
}
