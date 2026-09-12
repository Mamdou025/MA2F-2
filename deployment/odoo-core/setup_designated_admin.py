"""Prepare the confirmed administrator inactive; activate only after policy publication.

Uses a mode-0600 temporary runtime URI. Never prints credentials or reset links.
"""
import configparser
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from start_production import settings

ROOT = Path(__file__).resolve().parent
EMAIL = 'fallmamadou151@gmail.com'


def main():
    if sys.argv[1:] not in [['prepare'], ['activate']]:
        raise SystemExit('Choose prepare or activate explicitly')
    mode = sys.argv[1]
    os.umask(0o077)
    uri_path = Path('/tmp/ma2f-admin-runtime-uri')
    if uri_path.stat().st_mode & 0o077:
        raise SystemExit('Private runtime file permissions required')
    s = settings(uri_path.read_text().strip())
    result_path = ROOT / '.local/designated-admin-result.json'
    link_path = Path('/tmp/ma2f-admin-setup-link')
    code = f'''
import json,secrets
from pathlib import Path
from odoo import Command
assert env.cr.dbname == 'ma2f_odoo'
email={EMAIL!r}
users=env['res.users'].with_context(active_test=False,no_reset_password=True,tracking_disable=True,mail_create_nosubscribe=True)
marker=env.ref('ma2f_access.designated_admin',raise_if_not_found=False)
matches=users.search([('login','=',email)])
groups=['base.group_user','base.group_system','stock.group_stock_manager','purchase.group_purchase_manager','sales_team.group_sale_manager','mrp.group_mrp_manager','account.group_account_manager']
group_ids=[env.ref(x).id for x in groups]
if {mode!r} == 'prepare':
 if marker:
  assert matches == marker and marker.login == email and marker.id > 2
  user=marker
 else:
  assert not matches, 'Existing login requires review'
  assert users.search_count([('active','=',True),('share','=',False)]) == 0
  user=users.create({{'name':email,'login':email,'email':email,'active':True,'password':secrets.token_urlsafe(48),'group_ids':[Command.set(group_ids)]}})
  user.write({{'active':False}})
  assert user.id > 2 and not user.active and not user.share
  env['ir.model.data'].create({{'module':'ma2f_access','name':'designated_admin','model':'res.users','res_id':user.id,'noupdate':True}})
else:
 assert marker and matches == marker and marker.id > 2 and marker.login == email
 user=marker
 assert users.search_count([('active','=',True),('share','=',False),('id','!=',user.id)]) == 0
 assert all(user.has_group(g) for g in groups)
 user.write({{'active':True}})
 env['ir.config_parameter'].sudo().set_param('web.base.url','https://ma2f-odoo-mamdou025.replit.app')
 env['ir.config_parameter'].sudo().set_param('web.base.url.freeze','True')
 user.partner_id.signup_prepare(signup_type='reset')
 url=user.partner_id._get_signup_url_for_action()[user.partner_id.id]
 assert url.startswith('https://ma2f-odoo-mamdou025.replit.app/web/reset_password?')
 Path({str(link_path)!r}).write_text(url)
env.cr.commit()
Path({str(result_path)!r}).write_text(json.dumps({{'mode':{mode!r},'id':user.id,'email':email,'active':user.active,'businessDataChanged':False}}))
print('DESIGNATED_ADMIN_SETUP_OK')
'''
    with tempfile.TemporaryDirectory(prefix='ma2f-admin-config-') as directory:
        config = configparser.ConfigParser(interpolation=None)
        config['options'] = {
            'db_host': s['host'], 'db_port': '5432', 'db_name': 'ma2f_odoo',
            'db_user': s['user'], 'db_password': s['password'], 'db_sslmode': 'verify-full',
            'list_db': 'False', 'http_enable': 'False', 'max_cron_threads': '0',
            'data_dir': directory, 'addons_path': str(ROOT / '.local/odoo-source/addons'),
        }
        config_path = Path(directory) / 'odoo.conf'
        with config_path.open('w') as handle:
            config.write(handle)
        child = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'ODOO_')) and k != 'DATABASE_URL'}
        child['PGSSLROOTCERT'] = '/etc/ssl/certs/ca-certificates.crt'
        with (ROOT / '.local/designated-admin-setup.log').open('w') as log:
            result = subprocess.run([str(ROOT / '.local/venv/bin/python'), str(ROOT / '.local/odoo-source/odoo-bin'),
                'shell', '-c', str(config_path), '--no-http'], input=code, text=True,
                env=child, stdout=log, stderr=log, timeout=120)
        if result.returncode:
            raise SystemExit('Administrator setup failed; private log retained')
    print(result_path.read_text())


if __name__ == '__main__':
    main()

