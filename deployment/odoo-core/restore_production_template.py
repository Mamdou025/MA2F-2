"""Restore the verified empty development template into a fresh production database."""
from pathlib import Path
import configparser,subprocess,os,json,hashlib
import psycopg2
from psycopg2 import sql
R=Path(__file__).resolve().parent;P=R/'.local';os.umask(0o077)
admin=(P/'production-admin-url').read_text()
v=configparser.ConfigParser(interpolation=None);v.read(P/'odoo.conf');v=v['options']
child={k:w for k,w in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
dump=P/'production-template.dump'
with psycopg2.connect(host=v['db_host'],dbname=v['db_name'],user=v['db_user'],password=v['db_password']) as c:
 with c.cursor() as x:
  x.execute("SELECT (SELECT count(*) FROM res_users WHERE active AND NOT share),(SELECT count(*) FROM stock_move),(SELECT count(*) FROM account_move),(SELECT count(*) FROM mrp_production),(SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname<>'')");assert x.fetchone()==(0,0,0,0,0)
subprocess.run(['pg_dump','-h',v['db_host'],'-U',v['db_user'],'-d',v['db_name'],'-Fc','--no-owner','--no-acl','-f',str(dump)],env=dict(child,PGPASSWORD=v['db_password']),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
c=psycopg2.connect(admin,sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt');c.autocommit=True
with c.cursor() as x:
 x.execute("SELECT count(*) FROM pg_database WHERE datname='ma2f_odoo'");assert x.fetchone()==(0,)
 x.execute('SELECT current_user');owner=x.fetchone()[0]
 x.execute(sql.SQL('GRANT odoo_core_prod TO {}').format(sql.Identifier(owner)))
 try:x.execute('CREATE DATABASE ma2f_odoo OWNER odoo_core_prod TEMPLATE template0')
 finally:x.execute(sql.SQL('REVOKE odoo_core_prod FROM {}').format(sql.Identifier(owner)))
c.close()
password=(P/'production-runtime-password').read_text()
with (P/'production-restore.log').open('w') as log:
 result=subprocess.run(['pg_restore','-h','ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech','-U','odoo_core_prod','-d','ma2f_odoo','--no-owner','--no-acl','--exit-on-error','--single-transaction',str(dump)],env=dict(child,PGPASSWORD=password,PGSSLMODE='verify-full',PGSSLROOTCERT='/etc/ssl/certs/ca-certificates.crt'),stdout=log,stderr=log)
assert result.returncode==0,'Restore failed; inspect private log; do not rerun CREATE DATABASE'
with psycopg2.connect(host='ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech',dbname='ma2f_odoo',user='odoo_core_prod',password=password,sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt') as c:
 with c.cursor() as x:
  x.execute("INSERT INTO ir_config_parameter(key,value) VALUES ('auth_signup.invitation_scope','b2b'),('auth_signup.reset_password','False') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
  x.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  x.execute("SELECT (SELECT count(*) FROM res_users WHERE active AND NOT share),(SELECT count(*) FROM stock_move),(SELECT count(*) FROM account_move),(SELECT count(*) FROM mrp_production),(SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname<>'')");assert x.fetchone()==(0,0,0,0,0)
(P/'production-restore-result.json').write_text(json.dumps({'status':'restored_locked','database':'ma2f_odoo','templateSha256':hashlib.sha256(dump.read_bytes()).hexdigest(),'businessImported':False,'activeInternalAccounts':0}))
print('PRODUCTION_TEMPLATE_RESTORED_LOCKED')
