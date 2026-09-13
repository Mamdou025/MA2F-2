"""Launch production Odoo with a dedicated role; no bootstrap or account grants."""
import configparser,os,re,secrets,subprocess,tempfile
from pathlib import Path
from urllib.parse import urlsplit,unquote,parse_qs
import psycopg2
from integration_access import check_accounts, check_command_account
from community_sources import verified_addons_path
R=Path(__file__).resolve().parent
HOST='ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech'
REV='8da213dc6785e097f2558dc2d648b588957786a1'
MODULES='stock,purchase,sale_management,mrp,account,l10n_sn,product_expiry,mrp_product_expiry,mrp_account'.split(',')

def settings(uri):
 p=urlsplit(uri)
 if p.scheme!='postgresql' or p.hostname!=HOST or p.path!='/ma2f_odoo' or p.username!='odoo_core_prod' or not p.password or p.fragment or parse_qs(p.query)!={'sslmode':['verify-full']} or p.port not in (None,5432):
  raise ValueError('Dedicated production connection required')
 return dict(host=HOST,port=5432,dbname='ma2f_odoo',user='odoo_core_prod',password=unquote(p.password),sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt',connect_timeout=15)

def check(s):
 c=psycopg2.connect(**s)
 try:
  c.set_session(readonly=True)
  with c.cursor() as x:
   x.execute("SET LOCAL statement_timeout='15s'")
   x.execute('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')
   if x.fetchone()!=(False,)*5 or not c.info.ssl_in_use:raise ValueError('Restricted role and TLS required')
   x.execute('SELECT name,state FROM ir_module_module WHERE name=ANY(%s)',(MODULES,));m=dict(x.fetchall())
   if not all(m.get(n)=='installed' for n in MODULES):raise ValueError('Modules not ready')
   x.execute('SELECT key,value FROM ir_config_parameter WHERE key=ANY(%s)',(['ir_attachment.location','auth_signup.invitation_scope','database.is_neutralized'],));v=dict(x.fetchall())
   if v!={'ir_attachment.location':'db','auth_signup.invitation_scope':'b2b','database.is_neutralized':'true'}:raise ValueError('Storage or access configuration not ready')
   check_accounts(x, os.environ.get('ODOO_INTEGRATION_USER_ID'), os.environ.get('ODOO_ADMIN_USER_ID'))
   check_command_account(x, os.environ.get('ODOO_COMMAND_USER_ID'))
   x.execute("SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname<>''")
   if x.fetchone()!=(0,):raise ValueError('SQL attachments required')
  c.rollback()
 finally:c.close()

def main():
 os.umask(0o077)
 try:
  s=settings(os.environ.get('ODOO_PRODUCTION_RUNTIME_URL',''))
  check(s)
  port=int(os.environ.get('ODOO_HTTP_PORT','5000'))
  if not 1024<=port<=65535:raise ValueError('Invalid HTTP port')
  rev=(R/'.local/odoo-revision').read_text().strip()
  if rev!=REV:raise ValueError('Wrong Odoo revision')
  community_path=verified_addons_path()
 except Exception:
  raise SystemExit('Production preflight failed; verify runtime secret and initialized database. No credentials logged.')
 target=Path(tempfile.mkdtemp(prefix='ma2f-odoo-'))
 cfg=configparser.ConfigParser(interpolation=None)
 cfg['options']={'db_host':s['host'],'db_port':'5432','db_name':'ma2f_odoo','db_user':s['user'],'db_password':s['password'],'db_sslmode':'verify-full','dbfilter':'^ma2f_odoo$','list_db':'False','admin_passwd':secrets.token_urlsafe(48),'http_interface':'0.0.0.0','http_port':str(port),'proxy_mode':'True','workers':'0','max_cron_threads':'0','db_maxconn':'8','data_dir':str(target/'data'),'addons_path':str(R/'.local/odoo-source/addons')+','+community_path+','+str(R/'addons')}
 with (target/'odoo.conf').open('x') as f:cfg.write(f)
 child={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
 child['PGSSLROOTCERT']='/etc/ssl/certs/ca-certificates.crt'
 cmd=[str(R/'.local/venv/bin/python'),str(R/'.local/odoo-source/odoo-bin'),'-c',str(target/'odoo.conf')]
 print('Production database verified; starting locked Odoo',flush=True)
 os.execve(cmd[0],cmd,child)

if __name__=='__main__':main()
