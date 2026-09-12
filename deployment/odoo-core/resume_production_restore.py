"""Restore the verified empty development template into a fresh production database."""
from pathlib import Path
import configparser,subprocess,os,json,hashlib
import psycopg2
from psycopg2 import sql
R=Path(__file__).resolve().parent;P=R/'.local';os.umask(0o077)
with psycopg2.connect(host='ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech',dbname='ma2f_odoo',user='odoo_core_prod',password=(P/'production-runtime-password').read_text(),sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt') as c:
 with c.cursor() as x:
  x.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");assert x.fetchone()==(0,),'Partial restore exists; inspect before retry'
child={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
dump=P/'production-template.dump'
password=(P/'production-runtime-password').read_text()
with (P/'production-restore.log').open('w') as log:
 result=subprocess.run(['pg_restore','-h','ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech','-U','odoo_core_prod','-d','ma2f_odoo','--no-owner','--no-acl','--exit-on-error','--jobs=4',str(dump)],env=dict(child,PGPASSWORD=password,PGSSLMODE='verify-full',PGSSLROOTCERT='/etc/ssl/certs/ca-certificates.crt'),stdout=log,stderr=log)
assert result.returncode==0,'Restore failed; inspect private log; do not rerun CREATE DATABASE'
with psycopg2.connect(host='ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech',dbname='ma2f_odoo',user='odoo_core_prod',password=password,sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt') as c:
 with c.cursor() as x:
  x.execute("INSERT INTO ir_config_parameter(key,value) VALUES ('auth_signup.invitation_scope','b2b'),('auth_signup.reset_password','False') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
  x.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  x.execute("SELECT (SELECT count(*) FROM res_users WHERE active AND NOT share),(SELECT count(*) FROM stock_move),(SELECT count(*) FROM account_move),(SELECT count(*) FROM mrp_production),(SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname<>'')");assert x.fetchone()==(0,0,0,0,0)
(P/'production-restore-result.json').write_text(json.dumps({'status':'restored_locked','database':'ma2f_odoo','templateSha256':hashlib.sha256(dump.read_bytes()).hexdigest(),'businessImported':False,'activeInternalAccounts':0}))
print('PRODUCTION_TEMPLATE_RESTORED_LOCKED')
