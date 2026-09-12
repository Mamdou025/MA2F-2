import {Pool} from 'pg';
import {RuntimeStateRepository} from './runtimeState';

export function runtimeDatabaseConfig(env:NodeJS.ProcessEnv=process.env){
  let url:URL;try{url=new URL(env.MA2F_RUNTIME_DATABASE_URL||'');}catch{throw new Error('RUNTIME_DATABASE_REQUIRED');}
  if(url.protocol!=='postgresql:'||url.username!=='ma2f_app_runtime'||!url.password||!url.hostname||url.hash||
    decodeURIComponent(url.pathname.slice(1))!==env.MA2F_RUNTIME_DATABASE_NAME||env.MA2F_RUNTIME_DATABASE_NAME!=='neondb'||
    Array.from(url.searchParams).some(([k,v])=>k!=='sslmode'||v!=='verify-full'))throw new Error('INVALID_RUNTIME_DATABASE');
  url.search='';return url.toString();
}
export function createRuntimeState(env:NodeJS.ProcessEnv=process.env){
  const pool=new Pool({connectionString:runtimeDatabaseConfig(env),ssl:{rejectUnauthorized:true},options:'-c search_path=ma2f_runtime',max:5,connectionTimeoutMillis:8000});
  return {pool,repository:new RuntimeStateRepository(pool)};
}
