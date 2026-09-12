"""Test the real production launcher on a temporary port without granting access."""
from pathlib import Path
import os,subprocess,time,json,urllib.request,urllib.error,re
from urllib.parse import quote
R=Path(__file__).resolve().parent;P=R/'.local'
assert (P/'production-restore-result.json').exists()
u=os.environ.get('ODOO_PRODUCTION_RUNTIME_URL')
if not u:
 u='postgresql://odoo_core_prod:'+quote((P/'production-runtime-password').read_text(),safe='')+'@ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech/ma2f_odoo?sslmode=verify-full'
env=dict(os.environ,REPLIT_DEPLOYMENT='1',ODOO_PRODUCTION_RUNTIME_URL=u,ODOO_HTTP_PORT='18070')
with (P/'production-http.log').open('w') as log:
 proc=subprocess.Popen(['bash','start.sh'],cwd=R,env=env,stdout=log,stderr=log)
 try:
  deadline=time.monotonic()+180
  while True:
   if proc.poll() is not None:raise RuntimeError('Launcher exited; inspect private log')
   try:
    with urllib.request.urlopen('http://127.0.0.1:18070/web/login',timeout=10) as r:
     page=r.read();assert r.status==200 and b'name="login"' in page
     assert b'/web/signup' not in page
    break
   except (urllib.error.URLError,TimeoutError):
    if time.monotonic()>deadline:raise
    time.sleep(1)
  assets=re.findall(rb'(?:href|src)="([^"\s]+\.(?:css|js)(?:\?[^"\s]*)?)"',page)
  assert assets, 'No page assets found'
  for asset in assets:
   path=asset.decode()
   assert path.startswith('/'), 'Unexpected external asset'
   with urllib.request.urlopen('http://127.0.0.1:18070'+path,timeout=45) as r:
    body=r.read();assert r.status==200 and body
    assert b'CSS error message' not in body
  payload=json.dumps({'jsonrpc':'2.0','method':'call','params':{'db':'ma2f_odoo','login':'admin','password':'admin'},'id':1}).encode()
  req=urllib.request.Request('http://127.0.0.1:18070/web/session/authenticate',data=payload,headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=20) as r:result=json.load(r)
  assert result.get('error',{}).get('data',{}).get('name')=='odoo.exceptions.AccessDenied'
  report={'status':'passed','productionDatabase':True,'loginHttp':200,'signupHidden':True,'defaultAdminDenied':True,'businessImported':False,'pageAssetsChecked':len(assets)}
 finally:
  proc.terminate()
  try:proc.wait(timeout=20)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
 report['testServerStopped']=True
 (P/'production-http-result.json').write_text(json.dumps(report))
 print(json.dumps(report))
