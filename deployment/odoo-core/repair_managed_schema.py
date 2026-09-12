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
with connect() as c:
 with c.cursor() as x:
  x.execute('SELECT current_database()');assert x.fetchone()==('neondb',)
  x.execute('SELECT count(*) FROM pg_namespace WHERE nspname=%s',(ARCHIVE,));assert x.fetchone()==(0,)
  for name in ['stock_move','account_move','mrp_production']:
   x.execute('SELECT to_regclass(%s)',('public.'+name,))
   if x.fetchone()[0]:
    x.execute(sql.SQL('SELECT count(*) FROM public.{}').format(sql.Identifier(name)));assert x.fetchone()==(0,),'Business rows present; refuse repair'
if not backup.exists():run(['pg_dump','--format=custom','--no-owner','--no-acl','--file',str(backup),'neondb'],'managed-schema-backup.log')
run(['pg_restore','--list',str(backup)],'managed-schema-backup-list.log')
print('DEFAULT_DATABASE_BACKUP_VERIFIED',flush=True)
def section(name):
 result=subprocess.run(['pg_restore','--no-owner','--no-acl','--section='+name,'--file=-',str(template)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 body=result.stdout.decode()
 return '\n'.join(line for line in body.splitlines() if not line.startswith((chr(92)+'restrict ',chr(92)+'unrestrict '))).replace('CREATE SCHEMA public;','')
pre=section('pre-data');post=section('post-data')
with connect() as c:
 with c.cursor() as x:
  x.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(ARCHIVE)))
  for kind,keyword in [('r','TABLE'),('p','TABLE'),('v','VIEW'),('m','MATERIALIZED VIEW'),('S','SEQUENCE')]:
   x.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind=%s AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')",(kind,))
   for (name,) in x.fetchall():
    x.execute(sql.SQL('ALTER '+keyword+' public.{} SET SCHEMA {}').format(sql.Identifier(name),sql.Identifier(ARCHIVE)))
  x.execute("SELECT p.proname,pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname='odoo_core_prod' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')")
  for name,args in x.fetchall():
   x.execute(sql.SQL('ALTER FUNCTION public.{}('+args+') SET SCHEMA {}').format(sql.Identifier(name),sql.Identifier(ARCHIVE)))
  x.execute(pre)
print('OFFICIAL_PRE_DATA_RESTORED_OLD_SCHEMA_PRESERVED',flush=True)
run(['pg_restore','--no-owner','--no-acl','--exit-on-error','--data-only','--jobs=4','--dbname=neondb',str(template)],'managed-schema-data.log')
print('EMPTY_TEMPLATE_DATA_RESTORED',flush=True)
with connect() as c:
 with c.cursor() as x:
  x.execute(post)
  x.execute("SET search_path TO public")
  x.execute("INSERT INTO ir_config_parameter(key,value) VALUES ('auth_signup.invitation_scope','b2b'),('auth_signup.reset_password','False') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
  x.execute("SELECT (SELECT count(*) FROM res_users WHERE active AND NOT share),(SELECT count(*) FROM stock_move),(SELECT count(*) FROM account_move),(SELECT count(*) FROM mrp_production),(SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname<>'')");assert x.fetchone()==(0,0,0,0,0)
  x.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");tables=x.fetchone()[0]
report={'status':'passed','database':'neondb','runtimeDatabaseUntouched':'ma2f_odoo','priorSchemaPreserved':ARCHIVE,'backupSha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'templateSha256':TEMPLATE_SHA,'publicTableCount':tables,'businessImported':False,'activeInternalAccounts':0}
(P/'managed-schema-repair-result.json').write_text(json.dumps(report))
print(json.dumps(report),flush=True)
