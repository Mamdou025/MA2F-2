import {integrationConfig} from './odooIntegration';
import type {CommandOutbox} from './commandOutbox';

type Job = NonNullable<Awaited<ReturnType<CommandOutbox['claim']>>>;
type Queue = Pick<CommandOutbox,'claim'|'complete'|'uncertain'|'review'>;
export function validateOrderPayload(value:unknown){
  const p=value as Record<string,unknown>;
  if(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).sort().join(',')!=='customerId,packs,taxId,unitPriceIncludedFCFA')throw Error('INVALID_ORDER');
  for(const [key,max] of [['customerId',2147483647],['packs',100000],['taxId',2147483647],['unitPriceIncludedFCFA',1000000]] as const)
    if(!Number.isSafeInteger(p[key])||(p[key] as number)<1||(p[key] as number)>max)throw Error('INVALID_ORDER');
  return p as {customerId:number;packs:number;taxId:number;unitPriceIncludedFCFA:number};
}

/** Fixed draft-order RPC. Does not confirm, invoice, or reserve stock. */
export function orderDispatcher(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
  return async(job:Job)=>{
    if(env.MA2F_ODOO_ORDERS_ENABLED!=='true'||!env.ODOO_COMMAND_API_KEY)throw Error('ORDERS_DISABLED');
    const config=integrationConfig({...env,ODOO_API_KEY:env.ODOO_COMMAND_API_KEY});
    if(config.database!=='ma2f_odoo'||config.companyId!==1)throw Error('WRONG_COMMAND_DESTINATION');
    if(job.operation!=='order'||!/^[A-Za-z0-9_-]{1,128}$/.test(job.actorId)||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(job.requestId))throw Error('INVALID_ORDER');
    const p=validateOrderPayload(job.payload);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetcher(`${config.origin}/json/2/ma2f.core.operation/record_order`,{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{Authorization:`Bearer ${config.key}`,'X-Odoo-Database':config.database,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({command:{requestId:job.requestId,actorId:job.actorId,...p},context:{allowed_company_ids:[1]}})});
      if(!response.ok)throw Error('ODOO_RESULT_UNCONFIRMED');
      const reader=response.body?.getReader();if(!reader)throw Error('ODOO_RESULT_UNCONFIRMED');
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>16384){await reader.cancel();throw Error('ODOO_RESULT_UNCONFIRMED');}chunks.push(value);}}
      finally{reader.releaseLock();}
      const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!r||r.requestId!==job.requestId||r.customerId!==p.customerId||r.packs!==p.packs||r.taxId!==p.taxId||
        r.unitPriceIncludedFCFA!==p.unitPriceIncludedFCFA||r.totalIncludedFCFA!==p.packs*p.unitPriceIncludedFCFA||
        !Number.isSafeInteger(r.orderId)||r.orderId<=0||typeof r.orderName!=='string'||!r.orderName.trim()||
        r.state!=='draft'||r.stockReserved!==false||r.invoicePosted!==false||typeof r.replayed!=='boolean')throw Error('ODOO_RESULT_UNCONFIRMED');
      return {requestId:r.requestId,orderId:r.orderId,orderName:r.orderName,state:'draft',...p,
        totalIncludedFCFA:r.totalIncludedFCFA,stockReserved:false,invoicePosted:false,replayed:r.replayed};
    }finally{clearTimeout(timer);}
  };
}

export async function runOrderOnce(queue:Queue,dispatch:(job:Job)=>Promise<Record<string,unknown>>,
  authorize:(actorId:string,customerId:number)=>Promise<boolean>,enabled:boolean){
  if(!enabled)return 'disabled';
  const job=await queue.claim('order');if(!job)return 'idle';
  if(job.operation!=='order'){await queue.review(job.requestId,job.lease);return 'needs_review';}
  let p;
  try{p=validateOrderPayload(job.payload);}catch{await queue.review(job.requestId,job.lease);return 'needs_review';}
  try{
    if(!await authorize(job.actorId,p.customerId)){await queue.review(job.requestId,job.lease);return 'needs_review';}
    const receipt=await dispatch(job);await queue.complete(job.requestId,job.lease,receipt);return 'completed';
  }catch{
    await queue.uncertain(job.requestId,job.lease);return 'unconfirmed';
  }
}
