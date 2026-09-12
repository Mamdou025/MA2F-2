"""Initialize only the empty, dedicated Replit development database; no HTTP."""
import configparser
import json
import os
from pathlib import Path
import secrets
import subprocess
from urllib.parse import urlparse

import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / '.local'
REVISION = '8da213dc6785e097f2558dc2d648b588957786a1'
MODULES = 'stock,purchase,sale_management,mrp,account,l10n_sn,product_expiry,mrp_product_expiry,mrp_account'


def main():
    os.umask(0o077)
    if os.environ.get('REPLIT_DEPLOYMENT') == '1':
        raise RuntimeError('Development bootstrap cannot run in production')
    uri = os.environ['DATABASE_URL']
    parts = urlparse(uri)
    if parts.hostname != 'helium' or parts.path != '/heliumdb':
        raise RuntimeError('Expected dedicated development Helium database')
    revision = subprocess.check_output(['git', '-C', str(PRIVATE/'odoo-source'), 'rev-parse', 'HEAD'], text=True).strip()
    assert revision == REVISION
    config_path = PRIVATE / 'odoo.conf'
    if config_path.exists():
        raise RuntimeError('Configuration already exists; inspect state instead of reinitializing')
    with psycopg2.connect(uri) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
            assert cursor.fetchone()[0] == 0, 'Refusing nonempty database'
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname='odoo_core_dev'")
            assert cursor.fetchone() is None, 'Role already exists; inspect before retry'
            password = secrets.token_urlsafe(48)
            cursor.execute(sql.SQL('CREATE ROLE odoo_core_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD {}').format(sql.Literal(password)))
            cursor.execute('ALTER DATABASE heliumdb OWNER TO odoo_core_dev')
            cursor.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
            cursor.execute('GRANT USAGE, CREATE ON SCHEMA public TO odoo_core_dev')
            cursor.execute('CREATE EXTENSION IF NOT EXISTS unaccent')
            cursor.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    config = configparser.ConfigParser(interpolation=None)
    config['options'] = {
        'db_host': parts.hostname, 'db_port': str(parts.port or 5432),
        'db_user': 'odoo_core_dev', 'db_password': password,
        'db_name': 'heliumdb', 'dbfilter': '^heliumdb$', 'list_db': 'False',
        'admin_passwd': secrets.token_urlsafe(48), 'http_interface': '127.0.0.1',
        'http_port': '18069', 'workers': '0', 'max_cron_threads': '0',
        'data_dir': str(PRIVATE/'data'),
        'addons_path': str(PRIVATE/'odoo-source/addons'),
    }
    with config_path.open('x') as handle:
        config.write(handle)
    child = {k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k != 'DATABASE_URL'}
    base = [str(PRIVATE/'venv/bin/python'), str(PRIVATE/'odoo-source/odoo-bin')]
    subprocess.run(base + ['-c',str(config_path),'--no-http','--stop-after-init','--without-demo=True','-i',MODULES], env=child,check=True)
    code = """
import secrets,json
from odoo.modules.neutralize import neutralize_database
assert env.cr.dbname == 'heliumdb'
neutralize_database(env.cr)
users = env['res.users'].with_context(active_test=False).search([('share','=',False)])
assert not env.user.active
users.write({'password':secrets.token_urlsafe(48)})
users.filtered(lambda u: u.active).write({'active':False})
env['ir.config_parameter'].sudo().set_param('ir_attachment.location','db')
env['ir.attachment'].force_storage()
env.cr.commit()
names = ['stock','purchase','sale_management','mrp','account','l10n_sn','product_expiry','mrp_product_expiry','mrp_account']
states = {m.name:m.state for m in env['ir.module.module'].search([('name','in',names)])}
assert all(states.get(n)=='installed' for n in names)
env.cr.execute('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')
assert env.cr.fetchone() == (False,False,False)
assert not env['res.users'].search_count([('share','=',False),('active','=',True)])
assert env['ir.config_parameter'].sudo().get_param('ir_attachment.location')=='db'
assert not env['ir.attachment'].search_count([('store_fname','!=',False),'|',('res_field','=',False),('res_field','!=',False)])
env.cr.rollback()
print('ODOO_CORE_DEVELOPMENT_VERIFIED '+json.dumps(states))
"""
    subprocess.run(base + ['shell','-c',str(config_path),'--no-http'],input=code,text=True,env=child,check=True)
    (PRIVATE/'bootstrap-result.json').write_text(json.dumps({'status':'passed','environment':'development','revision':REVISION,'http':False,'internalUsersActive':0,'storage':'db','productionProvisioned':False}))
    print('DEVELOPMENT_BOOTSTRAP_OK')


if __name__ == '__main__':
    main()
