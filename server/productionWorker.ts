import {prepareProduction} from './productionPlan';
import {integrationConfig} from './odooIntegration';
import type {CommandOutbox} from './commandOutbox';

type Job = NonNullable<Awaited<ReturnType<CommandOutbox['claim']>>>;
type Queue = Pick<CommandOutbox,'claim'|'complete'|'uncertain'|'review'>;

/** Internal worker only. No HTTP route, timer or startup registration. */
export function productionDispatcher(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
  return async(job:Job)=>{
    if(env.MA2F_ODOO_WRITES_ENABLED!=='true'||!env.ODOO_COMMAND_API_KEY)throw Error('WRITES_DISABLED');
    const config=integrationConfig({...env,ODOO_API_KEY:env.ODOO_COMMAND_API_KEY});
    if(config.database!=='ma2f_odoo'||config.companyId!==1)throw Error('WRONG_COMMAND_DESTINATION');
    if(job.operation!=='production'||!job.payload||Object.keys(job.payload).sort().join(',')!=='netPacks,packsPerKg,sourceSha256')throw Error('INVALID_PRODUCTION_JOB');
    if(typeof job.payload.sourceSha256!=='string'||typeof job.payload.packsPerKg!=='string'||
      !/^[1-9][0-9]{0,5}$/.test(job.payload.packsPerKg)||
      !/^[A-Za-z0-9_-]{1,128}$/.test(job.actorId))throw Error('INVALID_PRODUCTION_JOB');
    const plan=prepareProduction({requestId:job.requestId,netPacks:job.payload.netPacks},{sourceSha256:job.payload.sourceSha256,packsPerKg:job.payload.packsPerKg});
    if(plan.netPacks>100000)throw Error('INVALID_PRODUCTION_JOB');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetcher(`${config.origin}/json/2/ma2f.core.operation/record_production`,{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{Authorization:`Bearer ${config.key}`,'X-Odoo-Database':config.database,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({command:{requestId:plan.requestId,actorId:job.actorId,saleablePacks:plan.netPacks,
          sourceSha256:plan.consumption.sourceSha256,packsPerKg:plan.consumption.packsPerKg},context:{allowed_company_ids:[1]}}),
      });
      if(!response.ok)throw Error('ODOO_RESULT_UNCONFIRMED');
      const reader=response.body?.getReader();if(!reader)throw Error('ODOO_RESULT_UNCONFIRMED');
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>16384){await reader.cancel();throw Error('ODOO_RESULT_UNCONFIRMED');}chunks.push(value);}}
      finally{reader.releaseLock();}
      const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!r||r.requestId!==plan.requestId||r.saleablePacks!==plan.netPacks||r.sachetsPerPack!==30||
        r.sourceSha256!==plan.consumption.sourceSha256||r.consumptionBasis!=='source_estimate'||
        r.estimatedKgNumerator!==plan.netPacks||r.estimatedKgDenominator!==Number(plan.consumption.packsPerKg)||
        !Number.isSafeInteger(r.productionId)||r.productionId<=0||typeof r.productionName!=='string'||!r.productionName.trim()||
        typeof r.appliedKg!=='number'||!Number.isFinite(r.appliedKg)||r.appliedKg<=0||typeof r.replayed!=='boolean')throw Error('ODOO_RESULT_UNCONFIRMED');
      // Keep only verified receipt fields; never persist upstream error bodies.
      return {requestId:r.requestId,productionId:r.productionId,productionName:r.productionName,saleablePacks:r.saleablePacks,
        sachetsPerPack:30,sourceSha256:r.sourceSha256,consumptionBasis:r.consumptionBasis,
        estimatedKgNumerator:r.estimatedKgNumerator,estimatedKgDenominator:r.estimatedKgDenominator,appliedKg:r.appliedKg,replayed:r.replayed};
    }finally{clearTimeout(timer);}
  };
}

export async function runProductionOnce(queue:Queue,dispatch:(job:Job)=>Promise<Record<string,unknown>>,
  authorize:(actorId:string)=>Promise<boolean>,enabled:boolean){
  if(!enabled)return 'disabled';
  const job=await queue.claim('production');if(!job)return 'idle';
  // Revoked users and unsupported operations require review, never a guessed success.
  if(job.operation!=='production'){await queue.review(job.requestId,job.lease);return 'needs_review';}
  try{
    if(!await authorize(job.actorId)){await queue.review(job.requestId,job.lease);return 'needs_review';}
    const receipt=await dispatch(job);
    await queue.complete(job.requestId,job.lease,receipt);
    return 'completed';
  }catch{
    // A timeout can occur after Odoo commits. Retry the identical persisted UUID.
    // Queue fencing prevents a stale worker overwriting a newer worker's outcome.
    await queue.uncertain(job.requestId,job.lease);return 'unconfirmed';
  }
}
