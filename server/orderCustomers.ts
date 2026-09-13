import {integrationConfig} from './odooIntegration';

/** Fixed RPC; never accepts caller-provided domains, models or field lists. */
export function orderCustomers(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
  return async()=>{
    if(env.MA2F_ODOO_ORDERS_ENABLED!=='true'||!env.ODOO_COMMAND_API_KEY)throw Error('ORDERS_DISABLED');
    const c=integrationConfig({...env,ODOO_API_KEY:env.ODOO_COMMAND_API_KEY});
    if(c.database!=='ma2f_odoo'||c.companyId!==1)throw Error('WRONG_COMMAND_DESTINATION');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetcher(c.origin+'/json/2/ma2f.core.operation/order_customers',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{Authorization:`Bearer ${c.key}`,'X-Odoo-Database':c.database,'Content-Type':'application/json'},
        body:JSON.stringify({context:{allowed_company_ids:[1]}})});
      if(!r.ok||!r.body)throw Error('CUSTOMERS_UNAVAILABLE');
      const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>512000){await reader.cancel();throw Error('CUSTOMERS_UNAVAILABLE');}chunks.push(value);}}
      finally{reader.releaseLock();}
      const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(rows)||rows.length>2000||rows.some(p=>!p||!Number.isSafeInteger(p.id)||p.id<1||typeof p.name!=='string'||!p.name.trim()||p.name.length>1000)||new Set(rows.map(p=>p.id)).size!==rows.length)throw Error('CUSTOMERS_UNAVAILABLE');
      return rows.map(p=>({id:p.id as number,name:p.name as string}));
    }finally{clearTimeout(timer);}
  };
}
