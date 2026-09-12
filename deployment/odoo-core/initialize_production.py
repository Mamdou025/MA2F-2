"""Initialize the verified empty production database once, with no public login."""
import configparser,json,os,secrets,subprocess
from pathlib import Path
from urllib.parse import urlsplit,unquote
import psycopg2
from psycopg2 import sql
R=Path(__file__).resolve().parent; P=R/'.local'
os.umask(0o077)
u=(P/'production-admin-url').read_text(); target=urlsplit(u)
assert target.hostname=='ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech' and target.path=='/neondb'
assert not (P/'production.conf').exists(),'Already provisioned: inspect instead of rerunning'
password=(P/'production-runtime-password').read_text()
assert len(password)>=48
with psycopg2.connect(u,sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt') as c:
 with c.cursor() as s:
  s.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");assert s.fetchone()==(0,)
  s.execute("SELECT count(*) FROM pg_roles WHERE rolname='odoo_core_prod'");assert s.fetchone()==(0,)
  s.execute(sql.SQL('CREATE ROLE odoo_core_prod LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}').format(sql.Literal(password)))
  s.execute('GRANT USAGE,CREATE ON SCHEMA public TO odoo_core_prod')
  s.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  s.execute('GRANT CONNECT,TEMPORARY ON DATABASE neondb TO odoo_core_prod')
  s.execute('CREATE EXTENSION IF NOT EXISTS unaccent');s.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
cfg=configparser.ConfigParser(interpolation=None)
cfg['options']={'db_host':target.hostname,'db_port':str(target.port or 5432),'db_name':'neondb','db_user':'odoo_core_prod','db_password':password,'db_sslmode':'verify-full','dbfilter':'^neondb$','list_db':'False','admin_passwd':secrets.token_urlsafe(48),'http_interface':'127.0.0.1','http_port':'18070','workers':'0','max_cron_threads':'0','data_dir':str(P/'production-data'),'addons_path':str(P/'odoo-source/addons')}
with (P/'production.conf').open('x') as f:cfg.write(f)
env={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
env['PGSSLROOTCERT']='/etc/ssl/certs/ca-certificates.crt'
base=[str(P/'venv/bin/python'),str(P/'odoo-source/odoo-bin'),'-c',str(P/'production.conf')]
modules='stock,purchase,sale_management,mrp,account,l10n_sn,product_expiry,mrp_product_expiry,mrp_account'
with (P/'production-init.log').open('w') as log:
 result=subprocess.run(base+['--no-http','--stop-after-init','--without-demo=True','-i',modules],env=env,stdout=log,stderr=log)
assert result.returncode==0,'Initialization failed; inspect private log'
code="""
import secrets,json
from odoo.modules.neutralize import neutralize_database
assert env.cr.dbname=='neondb'
neutralize_database(env.cr)
users=env['res.users'].with_context(active_test=False).search([('share','=',False)])
users.write({'password':secrets.token_urlsafe(48)})
users.filtered(lambda u:u.active).write({'active':False})
p=env['ir.config_parameter'].sudo()
p.set_param('auth_signup.invitation_scope','b2b')
p.set_param('auth_signup.reset_password','False')
p.set_param('ir_attachment.location','db')
env['ir.attachment'].force_storage()
assert env['res.users'].search_count([('share','=',False)])==0
assert all(env[m].search_count([])==0 for m in ['stock.move','account.move','mrp.production'])
env.cr.commit()
print('PRODUCTION_INITIALIZED_LOCKED')
"""
with (P/'production-lock.log').open('w') as log:
 result=subprocess.run(base[:2]+['shell']+base[2:]+['--no-http'],input=code,text=True,env=env,stdout=log,stderr=log)
assert result.returncode==0 and 'PRODUCTION_INITIALIZED_LOCKED' in (P/'production-lock.log').read_text(),'Account lock failed; inspect private log'
(P/'production-init-result.json').write_text(json.dumps({'status':'initialized_locked','businessImported':False,'administratorEnabled':False,'runtimeRole':'odoo_core_prod'}))
print('PRODUCTION_INITIALIZED_LOCKED')
