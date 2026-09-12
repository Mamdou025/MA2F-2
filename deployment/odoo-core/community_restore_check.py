import os,json,subprocess,psycopg2
from urllib.parse import urlsplit,unquote
from pathlib import Path
from community_maintenance import snapshot
b=json.loads(Path('.local/community-backup-latest.json').read_text())
u=urlsplit(os.environ['DATABASE_URL'])
assert u.hostname=='helium' and u.path=='/heliumdb', 'Isolated Replit development database required'
c=psycopg2.connect(os.environ['DATABASE_URL']); c.autocommit=True
q=c.cursor(); q.execute('CREATE DATABASE ma2f_community_restore_20260910')
v=c.get_dsn_parameters(); c.close(); v['dbname']='ma2f_community_restore_20260910'
e=os.environ.copy()
e.update(PGHOST=u.hostname,PGPORT=str(u.port or 5432),PGUSER=unquote(u.username),PGPASSWORD=unquote(u.password or ''),PGDATABASE=v['dbname'])
with open('.local/community-restore.log','w') as f: subprocess.run(['pg_restore','--no-owner','--no-acl','--exit-on-error','--dbname',v['dbname'],b['archive']],env=e,stdout=f,stderr=f,check=True)
r=psycopg2.connect(**v); s=snapshot(r); r.close()
assert s==b['snapshot'], 'Restored database differs'
Path('.local/community-restore-result.json').write_text(json.dumps({'restored':True,'snapshot_matches':True,'database':v['dbname']}))
print('RESTORE_VERIFIED: all record counts and digests match')
