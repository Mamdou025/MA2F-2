"""Private native recovery drill: new DB only; source retained; no HTTP."""
from pathlib import Path
import os,subprocess,json,hashlib,shutil,configparser,uuid
P=Path(__file__).resolve().parent;N=P/'.local/native';SRC='ma2f_native_pilot'
STAMP=uuid.uuid4().hex[:12];DST='ma2f_native_restore_'+STAMP
B=N/'backups'/STAMP;B.mkdir(parents=True,mode=0o700)
child={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
c=configparser.ConfigParser();c.read(N/'odoo.conf')
assert c['options']['db_host']=='/tmp/ma2f-odoo-native-socket' and c['options']['db_user']=='odoo_native' and c['options']['db_name']==SRC
conn=['-h','/tmp/ma2f-odoo-native-socket','-p','55432','-U','odoo_native']
userenv=dict(child,PGPASSWORD=(N/'odoo-db-password').read_text())
adminenv=dict(child,PGPASSWORD=(N/'db-password').read_text())
def run(cmd,env=child,code=None):
 r=subprocess.run(cmd,env=env,input=code,text=True,capture_output=True,timeout=180)
 if r.returncode:
  (B/'failure.log').write_text(r.stdout+r.stderr)
  raise RuntimeError('Recovery operation failed; see private failure.log')
 return r.stdout
def shell(db,code):
 assert db in [SRC,DST]
 return run([str(N/'venv/bin/python'),str(N/'odoo-source/odoo-bin'),'shell','-c',str(N/'odoo.conf'),'-d',db,'--no-http'],code=code)
models=['product.product','stock.move','stock.quant','mrp.production','account.move','res.partner','ir.attachment']
fixture='''from pathlib import Path
import json,hashlib
assert env.cr.dbname=='ma2f_native_pilot'
payload=b'MA2F NATIVE RESTORE DRILL - FICTIONAL DATA ONLY'
partner=env['res.partner'].create({'name':'PILOTE RESTAURATION '+STAMP})
a=env['ir.attachment'].create({'name':'native-restore-'+STAMP+'.txt','raw':payload,'res_model':'res.partner','res_id':partner.id,'mimetype':'text/plain'})
assert a.store_fname,'Must test disk filestore'
counts={m:env[m].with_context(active_test=False).search_count([]) for m in MODELS}
manifest={'attachmentId':a.id,'partnerId':partner.id,'partnerName':partner.name,'payloadSha256':hashlib.sha256(payload).hexdigest(),'storeName':a.store_fname,'counts':counts}
env.cr.commit()
Path(MANIFEST).write_text(json.dumps(manifest))
'''
prefix='STAMP='+repr(STAMP)+chr(10)+'MODELS='+repr(models)+chr(10)+'MANIFEST='+repr(str(B/'manifest.json'))+chr(10)
shell(SRC,prefix+fixture)
manifest=json.loads((B/'manifest.json').read_text())
dump=B/'database.dump'
run(['pg_dump',*conn,'-d',SRC,'-Fc','--no-owner','--no-acl','-f',str(dump)],env=userenv)
files=N/'filestore/filestore'/SRC
assert (files/manifest['storeName']).is_file()
shutil.copytree(files,B/'filestore')
def hashes(root):return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
file_hashes=hashes(B/'filestore');assert file_hashes==hashes(files)
dump_hash=hashlib.sha256(dump.read_bytes()).hexdigest()
(B/'checksums.json').write_text(json.dumps({'database':dump_hash,'filestore':file_hashes},indent=2))
run(['createdb','-h','/tmp/ma2f-odoo-native-socket','-p','55432','-U','ma2f_native','--owner=odoo_native','--template=template0',DST],env=adminenv)
run(['pg_restore',*conn,'-d',DST,'--exit-on-error','--no-owner','--no-acl',str(dump)],env=userenv)
restored=N/'filestore/filestore'/DST
shutil.copytree(B/'filestore',restored)
assert hashes(restored)==file_hashes
check='''import json,hashlib
from pathlib import Path
from odoo.modules.neutralize import neutralize_database
assert env.cr.dbname==DESTINATION
neutralize_database(env.cr)
env.cr.commit()
m=json.loads(Path(MANIFEST).read_text())
assert all(env[model].with_context(active_test=False).search_count([])==count for model,count in m['counts'].items())
a=env['ir.attachment'].browse(m['attachmentId'])
assert a.store_fname==m['storeName'] and hashlib.sha256(a.raw).hexdigest()==m['payloadSha256']
assert env['res.partner'].browse(m['partnerId']).name==m['partnerName']
assert env['ir.cron'].search_count([('active','=',True),('id','!=',env.ref('base.autovacuum_job').id)])==0
assert env['ir.config_parameter'].sudo().get_param('database.is_neutralized')=='true'
env.cr.rollback()
print('RESTORED_NATIVE_DATA_AND_FILE_VERIFIED')
'''
output=shell(DST,'DESTINATION='+repr(DST)+chr(10)+'MANIFEST='+repr(str(B/'manifest.json'))+chr(10)+check)
assert 'RESTORED_NATIVE_DATA_AND_FILE_VERIFIED' in output
result={'status':'passed','source':SRC,'restoredDatabase':DST,'backupDirectory':str(B),'databaseSha256':dump_hash,'fileCount':len(file_hashes),'attachmentVerified':True,'countsVerified':manifest['counts'],'neutralized':True,'scope':'workspace recovery only; no durable external backup or Publishing validation'}
(B/'result.json').write_text(json.dumps(result,indent=2));(N/'native-backup-result.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
