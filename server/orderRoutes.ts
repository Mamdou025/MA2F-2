import express from 'express';
import {createLocalAuth,type LocalAuthRuntime} from './localAuth';
import {requireLocalAction} from './localAuthorization';
import {canLocalAction,loadLocalProfile} from './localProfile';
import {createRuntimeState} from './runtimeDatabase';
import {CommandOutbox} from './commandOutbox';
import {validateOrderPayload,orderDispatcher,runOrderOnce} from './orderWorker';

type Queue=Pick<CommandOutbox,'enqueue'|'status'|'claim'|'complete'|'review'|'uncertain'>;
/** Opt-in native-auth draft-order API. No Firebase or anonymous write fallback. */
export function orderRouter(env:NodeJS.ProcessEnv=process.env,deps?:{auth:LocalAuthRuntime;queue:Queue}){
  const router=express.Router();router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  if(env.MA2F_LOCAL_AUTH_ENABLED!=='true'||env.MA2F_RUNTIME_ENABLED!=='true'||env.MA2F_ODOO_ORDERS_ENABLED!=='true'){
    router.use((_req,res)=>{res.status(503).json({error:'orders_not_enabled'});});return router;
  }
  const auth=deps?.auth||createLocalAuth(env),queue=deps?.queue||new CommandOutbox(createRuntimeState(env).pool);
  const authorize=async(actor:string)=>{
    const result=await auth.pool.query('SELECT id,email,"emailVerified" FROM ma2f_auth."user" WHERE id=$1',[actor]);
    return !!result.rows[0]&&canLocalAction(await loadLocalProfile(auth.pool,result.rows[0]),'commandes','create');
  };
  // Production polling only when explicitly commissioned. One job at a time.
  if(!deps){
    const dispatch=orderDispatcher(env);
    const tick=async()=>{try{await runOrderOnce(queue,dispatch,authorize,true);}catch{/* Durable lease permits recovery. */}
      const timer=setTimeout(tick,2000);timer.unref();};
    const timer=setTimeout(tick,2000);timer.unref();
  }
  router.get('/:requestId',requireLocalAction(auth,'commandes','read'),async(req,res)=>{
    try{const status=await queue.status(req.params.requestId,res.locals.ma2f.userId);
      if(!status){res.status(404).json({error:'order_request_not_found'});return;}res.json(status);
    }catch(error){res.status(error instanceof Error&&error.message==='INVALID_REQUEST_ID'?400:503).json({error:'order_status_unavailable'});}
  });
  router.post('/',requireLocalAction(auth,'commandes','create'),(req,res,next)=>{
    if(!env.MA2F_AUTH_ORIGIN||req.headers.origin!==env.MA2F_AUTH_ORIGIN){res.status(403).json({error:'origin_rejected'});return;}next();
  },express.json({limit:'16kb',strict:true}),async(req,res)=>{
    try{
      const b=req.body;
      if(!b||Object.keys(b).sort().join(',')!=='customerId,packs,requestId,unitPriceFCFA')throw Error('INVALID_ORDER');
      const payload=validateOrderPayload({customerId:b.customerId,packs:b.packs,unitPriceFCFA:b.unitPriceFCFA});
      const actor=res.locals.ma2f.userId;
      if(!await authorize(actor)){res.status(403).json({error:'business_permission_required'});return;}
      const status=await queue.enqueue({requestId:b.requestId,actorId:actor,operation:'order',payload});
      res.status(status.state==='completed'?200:202).json(status);
    }catch(error){const code=error instanceof Error?error.message:'';
      res.status(code==='COMMAND_ID_CONFLICT'?409:code.startsWith('INVALID_')?400:503).json({error:code==='COMMAND_ID_CONFLICT'?'request_id_conflict':code.startsWith('INVALID_')?'invalid_order':'order_submission_unavailable'});}
  });
  router.use((_req,res)=>{res.status(405).json({error:'operation_not_enabled'});});
  router.use(((error,_req,res,next)=>{if(res.headersSent){next(error);return;}res.status(error?.type==='entity.too.large'?413:400).json({error:'invalid_order'});}) as express.ErrorRequestHandler);
  return router;
}
