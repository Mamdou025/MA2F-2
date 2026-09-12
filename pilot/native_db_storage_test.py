"""Fictional native Odoo attachment migration and SQL-only recovery drill."""
from pathlib import Path
import os,json,subprocess,uuid,hashlib
P=Path(__file__).resolve().parent;N=P/'.local/native'
DST='ma2f_dbfiles_'+uuid.uuid4().hex[:12];D=N/'db-storage-tests'/DST;D.mkdir(parents=True,mode=0o700)
child={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
def run(cmd,env=child,code=None):
 r=subprocess.run(cmd,env=env,input=code,text=True,capture_output=True,timeout=240)
 if r.returncode:
  (D/'failure.log').write_text(r.stdout+r.stderr);raise RuntimeError('Native attachment test failed; private log retained')
 return r.stdout
def shell(db,code,isolated=False):
 assert db in ['ma2f_native_pilot',DST]
 cmd=[str(N/'venv/bin/python'),str(N/'odoo-source/odoo-bin'),'shell','-c',str(N/'odoo.conf'),'-d',db,'--no-http']
 if isolated:cmd+=['--data-dir',str(D/'empty-data-dir')]
 return run(cmd,code=code)
code='''from pathlib import Path
import hashlib,json
assert env.cr.dbname=='ma2f_native_pilot'
attachments=env['ir.attachment'].with_context(active_test=False).search([('type','=','binary'),'|',('res_field','=',False),('res_field','!=',False)])
before={str(a.id):hashlib.sha256(a.raw).hexdigest() for a in attachments}
try:
 env['ir.config_parameter'].sudo().set_param('ir_attachment.location','db')
 env['ir.attachment'].force_storage()
 env.invalidate_all()
 for a in attachments:
  assert not a.store_fname
  assert hashlib.sha256(a.raw).hexdigest()==before[str(a.id)]
 payload=b'MA2F native database attachment fixture'
 a=env['ir.attachment'].create({'name':'PILOTE DB storage.txt','raw':payload,'mimetype':'text/plain'})
 assert not a.store_fname and a.db_datas and a.raw==payload
 before[str(a.id)]=hashlib.sha256(payload).hexdigest()
 env.cr.commit()
 Path(MANIFEST).write_text(json.dumps(before))
except Exception:
 env.cr.rollback();raise
'''
shell('ma2f_native_pilot','MANIFEST='+repr(str(D/'attachments.json'))+chr(10)+code)
conn=['-h','/tmp/ma2f-odoo-native-socket','-p','55432','-U','odoo_native']
u=dict(child,PGPASSWORD=(N/'odoo-db-password').read_text());a=dict(child,PGPASSWORD=(N/'db-password').read_text())
run(['pg_dump',*conn,'-d','ma2f_native_pilot','-Fc','--no-owner','--no-acl','-f',str(D/'database.dump')],env=u)
run(['createdb','-h','/tmp/ma2f-odoo-native-socket','-p','55432','-U','ma2f_native','--owner=odoo_native','--template=template0',DST],env=a)
run(['pg_restore',*conn,'-d',DST,'--no-owner','--no-acl','--exit-on-error',str(D/'database.dump')],env=u)
check='''from pathlib import Path
import hashlib,json
from odoo.modules.neutralize import neutralize_database
assert env.cr.dbname==DESTINATION
neutralize_database(env.cr);env.cr.commit()
assert env['ir.config_parameter'].sudo().get_param('ir_attachment.location')=='db'
expected=json.loads(Path(MANIFEST).read_text())
for key,sha in expected.items():
 a=env['ir.attachment'].browse(int(key));assert a.exists() and not a.store_fname
 assert hashlib.sha256(a.raw).hexdigest()==sha
assert not Path(env['ir.attachment']._filestore()).exists()
env.cr.rollback()
print('SQL_ONLY_ATTACHMENTS_VERIFIED')
'''
output=shell(DST,'DESTINATION='+repr(DST)+chr(10)+'MANIFEST='+repr(str(D/'attachments.json'))+chr(10)+check,True)
assert 'SQL_ONLY_ATTACHMENTS_VERIFIED' in output
result={'status':'passed','restoreDatabase':DST,'attachmentsVerified':len(json.loads((D/'attachments.json').read_text())),'filestoreCopied':False,'nativeStorage':'db','dumpSha256':hashlib.sha256((D/'database.dump').read_bytes()).hexdigest(),'scope':'fictional native cluster; production provisioning still required'}
(D/'result.json').write_text(json.dumps(result,indent=2));(N/'db-storage-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
