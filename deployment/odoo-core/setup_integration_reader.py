"""Prepare a read-only service identity inactive, then activate after startup policy publication."""
import configparser
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from start_production import settings

ROOT = Path(__file__).resolve().parent
SOURCE_SHA = 'f6a1f35312dd1550e9015800b8396ae16ca6efd3d28e223b197608ddb9c27fdb'


def main():
    if sys.argv[1:] not in [['preview'], ['prepare'], ['activate']]:
        raise SystemExit('Explicit preview, prepare or activate required')
    mode = sys.argv[1]
    os.umask(0o077)
    config_values = settings(getpass.getpass('Odoo runtime connection: '))
    result_path = ROOT / '.local/integration-reader-result.json'
    code = f'''
import json,secrets,sys
from pathlib import Path
from datetime import datetime,timedelta
from odoo import Command
sys.path.insert(0,{str(ROOT)!r})
from integration_access import check_accounts
assert env.cr.dbname=='ma2f_odoo'
assert env.ref('ma2f_access.designated_admin').id==6
assert env['ir.config_parameter'].sudo().get_param('ma2f.integration.business_enabled','false')=='false'
company=env.ref('ma2f_integration.company')
assert company.id==1 and company.currency_id.name=='XOF'
mode={mode!r}
users=env['res.users'].with_context(active_test=False,no_reset_password=True,tracking_disable=True,mail_create_nosubscribe=True)
reader=env.ref('ma2f_integration.reader_user',raise_if_not_found=False)
assert set(users.search([('active','=',True),('share','=',False)]).ids).issubset({{6,reader.id if reader else 0}})
if mode=='activate': assert reader, 'Prepare the reader first'

def mark(name,record):
 old=env.ref('ma2f_integration.'+name,raise_if_not_found=False)
 if old: assert old==record
 else:env['ir.model.data'].create({{'module':'ma2f_integration','name':name,'model':record._name,'res_id':record.id,'noupdate':True}})
 return record

group=env.ref('ma2f_integration.reader_group',raise_if_not_found=False)
if not group:group=mark('reader_group',env['res.groups'].create({{'name':'MA2F integration: read only','api_key_duration':30.0}}))
assert group.api_key_duration==30.0
for model_name in ['stock.quant','stock.location','stock.lot','stock.warehouse','product.product','product.template','mrp.bom','mrp.bom.line']:
 model=env['ir.model']._get(model_name);key='read_'+model_name.replace('.','_')
 acl=env.ref('ma2f_integration.'+key,raise_if_not_found=False)
 if not acl:acl=mark(key,env['ir.model.access'].create({{'name':'MA2F read '+model_name,'model_id':model.id,'group_id':group.id,'perm_read':True,'perm_write':False,'perm_create':False,'perm_unlink':False}}))
 assert acl.group_id==group and acl.model_id==model and acl.perm_read and not any([acl.perm_write,acl.perm_create,acl.perm_unlink])
 if 'company_id' in env[model_name]._fields:
  rule=env.ref('ma2f_integration.rule_'+key,raise_if_not_found=False)
  domain="['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]"
  if not rule:rule=mark('rule_'+key,env['ir.rule'].create({{'name':'MA2F company '+model_name,'model_id':model.id,'groups':[Command.link(group.id)],'domain_force':domain}}))
  assert rule.domain_force==domain and group in rule.groups
if not reader:
 assert not users.search_count([('login','=','ma2f.integration')])
 reader=users.create({{'name':'MA2F integration service','login':'ma2f.integration','active':True,'password':secrets.token_urlsafe(48),
  'company_id':company.id,'company_ids':[Command.set([company.id])],'group_ids':[Command.set([env.ref('base.group_portal').id,group.id])]}})
 mark('reader_user',reader)
assert reader.login=='ma2f.integration' and reader.id>6 and reader.share
assert reader.company_ids==company and reader.company_id==company
assert reader.has_group('ma2f_integration.reader_group') and not reader.has_group('base.group_system')
reader.active=True
env.flush_all()
check_accounts(env.cr,str(reader.id),'6')
key_path=Path('/tmp/ma2f-odoo-reader-key.json')
if mode in ['preview','prepare']:
 assert not key_path.exists(), 'Existing private key output requires review'
 expiry=datetime.now()+timedelta(days=30)
 key=env['res.users.apikeys'].with_user(reader)._generate('rpc','MA2F read integration',expiry)
 assert key
 if mode=='prepare':key_path.write_text(json.dumps({{'key':key,'userId':reader.id,'companyId':company.id,'expiresAt':expiry.isoformat()}}))
 reader.active=False
report={{'status':'validated','mode':mode,'userId':reader.id,'companyId':company.id,'active':reader.active,'readOnly':True,'businessWritesEnabled':False}}
if mode=='preview':env.cr.rollback()
else:env.cr.commit()
Path({str(result_path)!r}).write_text(json.dumps(report))
'''
    with tempfile.TemporaryDirectory(prefix='ma2f-reader-') as directory:
        config = configparser.ConfigParser(interpolation=None)
        config['options'] = {'db_host': config_values['host'], 'db_port': '5432', 'db_name': 'ma2f_odoo',
            'db_user': config_values['user'], 'db_password': config_values['password'], 'db_sslmode': 'verify-full',
            'list_db': 'False', 'http_enable': 'False', 'max_cron_threads': '0', 'data_dir': directory,
            'addons_path': str(ROOT / '.local/odoo-source/addons')}
        config_path = Path(directory) / 'odoo.conf'
        with config_path.open('w') as handle:
            config.write(handle)
        child = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'ODOO_')) and k != 'DATABASE_URL'}
        child['PGSSLROOTCERT'] = '/etc/ssl/certs/ca-certificates.crt'
        result_path.unlink(missing_ok=True)
        with (ROOT / '.local/integration-reader.log').open('w') as log:
            result = subprocess.run([str(ROOT / '.local/venv/bin/python'), str(ROOT / '.local/odoo-source/odoo-bin'),
                'shell', '-c', str(config_path), '--no-http'], input=code, text=True,
                env=child, stdout=log, stderr=log, timeout=120)
        if result.returncode or not result_path.exists():
            raise SystemExit('Integration reader preparation failed; private log retained')
    print(result_path.read_text())


if __name__ == '__main__':
    main()
