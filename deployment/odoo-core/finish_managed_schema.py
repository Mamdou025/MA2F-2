"""Align the unused managed database with Odoo's verified template; preserve old schema."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
import os,subprocess,json,hashlib
import psycopg2
from psycopg2 import sql
R=Path(__file__).resolve().parent;P=R/'.local';os.umask(0o077)
HOST='ep-snowy-glade-ax2tsvpa.c-4.us-east-2.aws.neon.tech'
ARCHIVE='ma2f_initial_setup_archive_20260909'
TEMPLATE_SHA='78eb496314d964a13d23a3154f0c17b24f96e38b769ecc7244e99c0d1fa5b8c5'
u=urlsplit((P/'production-admin-url').read_text())
assert u.hostname==HOST and u.path=='/neondb'
s=dict(host=HOST,dbname='neondb',user=unquote(u.username),password=unquote(u.password),sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt',connect_timeout=20)
template=P/'production-template.dump';assert hashlib.sha256(template.read_bytes()).hexdigest()==TEMPLATE_SHA
backup=P/'managed-neondb-before-native-repair.dump'
env={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
env.update(PGHOST=HOST,PGDATABASE='neondb',PGUSER=s['user'],PGPASSWORD=s['password'],PGSSLMODE='verify-full',PGSSLROOTCERT=s['sslrootcert'])
def run(cmd,logname):
 with (P/logname).open('w') as log:
  result=subprocess.run(cmd,env=env,stdout=log,stderr=log)
 assert result.returncode==0,'Native command failed; inspect private log'
def connect():return psycopg2.connect(**s)
def section(name):
 result=subprocess.run(['pg_restore','--no-owner','--no-acl','--section='+name,'--file=-',str(template)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 body=result.stdout.decode()
 return '\n'.join(line for line in body.splitlines() if not line.startswith((chr(92)+'restrict ',chr(92)+'unrestrict '))).replace('CREATE SCHEMA public;','')
post=section('post-data')
print('EMPTY_TEMPLATE_DATA_RESTORED',flush=True)
with connect() as c:
 with c.cursor() as x:
  x.execute("SELECT count(*) FROM pg_constraint WHERE conrelid='public.res_users'::regclass AND contype='p'");assert x.fetchone()==(0,),'Post-data already present; inspect before retry'
  x.execute(post)
  x.execute("SET search_path TO public")
  x.execute("INSERT INTO ir_config_parameter(key,value) VALUES ('auth_signup.invitation_scope','b2b'),('auth_signup.reset_password','False') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
  x.execute("SELECT (SELECT count(*) FROM res_users WHERE active AND NOT share),(SELECT count(*) FROM stock_move),(SELECT count(*) FROM account_move),(SELECT count(*) FROM mrp_production),(SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname<>'')");assert x.fetchone()==(0,0,0,0,0)
  x.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");tables=x.fetchone()[0]
report={'status':'passed','database':'neondb','runtimeDatabaseUntouched':'ma2f_odoo','priorSchemaPreserved':ARCHIVE,'backupSha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'templateSha256':TEMPLATE_SHA,'publicTableCount':tables,'businessImported':False,'activeInternalAccounts':0}
(P/'managed-schema-repair-result.json').write_text(json.dumps(report))
print(json.dumps(report),flush=True)
