import express from 'express';
import {createLocalAuth,type LocalAuthRuntime} from './localAuth';
import {requireLocalAction} from './localAuthorization';
import {loadLocalProfile} from './localProfile';
import {createRuntimeState} from './runtimeDatabase';
import {type RuntimeStateRepository,stateHash} from './runtimeState';
import {validateClientChanges} from './clientChanges';

export function runtimeClientRouter(env:NodeJS.ProcessEnv=process.env,deps?:{auth:LocalAuthRuntime;repository:RuntimeStateRepository}){
  const router=express.Router();router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  if(env.MA2F_LOCAL_AUTH_ENABLED!=='true'||env.MA2F_RUNTIME_ENABLED!=='true'){
    router.use((_req,res)=>{res.status(503).json({error:'runtime_not_enabled'});});return router;
  }
  const auth=deps?.auth||createLocalAuth(env),repository=deps?.repository||createRuntimeState(env).repository;
  router.get('/',requireLocalAction(auth,'clients','read'),async(_req,res)=>{
    try{const row=await repository.read();res.json({revision:row.revision,clients:row.state.clients,beforeHash:stateHash(row.state.clients)});}
    catch{res.status(503).json({error:'runtime_unavailable'});}
  });
  router.post('/',requireLocalAction(auth,'clients','read'),(req,res,next)=>{
    if(req.headers.origin!==env.MA2F_AUTH_ORIGIN){res.status(403).json({error:'origin_rejected'});return;}next();
  },express.json({limit:'4mb',strict:true}),async(req,res)=>{
    try{
      const b=req.body;
      if(!b||Object.keys(b).sort().join(',')!=='beforeHash,clients,requestId,revision') {res.status(400).json({error:'invalid_request'});return;}
      const userId=res.locals.ma2f.userId;
      const result=await repository.change(b.requestId,userId,b.revision,[{field:'clients',beforeHash:b.beforeHash,value:b.clients}],async(state,changes)=>{
        // Re-check revocation when the transaction obtains its lock, not just before waiting.
        const user=await auth.pool.query('SELECT id,email,"emailVerified" FROM ma2f_auth."user" WHERE id=$1',[userId]);
        if(!user.rows[0])throw new Error('BUSINESS_PERMISSION_REQUIRED');
        const profile=await loadLocalProfile(auth.pool,user.rows[0]);validateClientChanges(profile,state,changes);
      });res.json(result);
    }catch(error){
      const code=error instanceof Error?error.message:'';
      if(['STATE_REVISION_CONFLICT','STATE_FIELD_CONFLICT','REQUEST_ID_CONFLICT','CLIENT_HAS_BUSINESS_REFERENCES','AMBIGUOUS_CLIENT_ID','SOURCE_FIELD_CHANGE_REQUIRES_REVIEW','CLIENT_RENAME_REQUIRES_REFERENCE_MIGRATION'].includes(code))res.status(409).json({error:code.toLowerCase()});
      else if(code==='BUSINESS_PERMISSION_REQUIRED')res.status(403).json({error:'business_permission_required'});
      else if(code.startsWith('INVALID_')||code==='STATE_CHANGE_TOO_LARGE')res.status(400).json({error:'invalid_request'});
      else res.status(503).json({error:'runtime_unavailable'});
    }
  });
  router.use((_req,res)=>{res.status(405).json({error:'operation_not_enabled'});});
  router.use(((error,req,res,next)=>{if(res.headersSent){next(error);return;}res.status(error?.type==='entity.too.large'?413:400).json({error:'invalid_request'});}) as express.ErrorRequestHandler);
  return router;
}
