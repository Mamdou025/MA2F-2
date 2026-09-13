"""Private draft-only commissioning. Credentials stay in hidden input/private files."""
import configparser, getpass, hashlib, json, os, subprocess, sys, tempfile
from pathlib import Path
import psycopg2
from start_production import settings
from community_sources import verified_addons_path
from community_maintenance import snapshot

ROOT=Path(__file__).resolve().parent

def main():
    assert sys.argv[1:] in [['install'],['prepare'],['enable'],['verify']]
    mode=sys.argv[1];os.umask(0o077)
    s=settings(getpass.getpass('Existing Odoo runtime connection: '))
    with psycopg2.connect(**s) as db:before=snapshot(db)
    if mode=='install':
        backup=json.loads((ROOT/'.local/community-backup-latest.json').read_text())
        assert hashlib.sha256(Path(backup['archive']).read_bytes()).hexdigest()==backup['sha256']
        assert before==backup['snapshot'],'Fresh unchanged backup required'
    result_path=ROOT/'.local/order-commission-result.json'
    result_path.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='ma2f-order-') as directory:
        cfg=configparser.ConfigParser(interpolation=None)
        cfg['options']={'db_host':s['host'],'db_port':'5432','db_name':'ma2f_odoo','db_user':s['user'],
            'db_password':s['password'],'db_sslmode':'verify-full','list_db':'False','http_enable':'False',
            'max_cron_threads':'0','data_dir':directory,'addons_path':str(ROOT/'.local/odoo-source/addons')+','+verified_addons_path()+','+str(ROOT/'addons')}
        path=Path(directory)/'odoo.conf'
        with path.open('w') as output:cfg.write(output)
        child={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
        child['PGSSLROOTCERT']=s['sslrootcert']
        command=[str(ROOT/'.local/venv/bin/python'),str(ROOT/'.local/odoo-source/odoo-bin')]
        if mode=='install':command+=['-c',str(path),'-i','ma2f_core','--without-demo=True','--stop-after-init','--no-http'];code=None
        else:
            command+=['shell','-c',str(path),'--no-http']
            code='MODE='+repr(mode)+'\nRESULT_PATH='+repr(str(result_path))+'\n'+(ROOT/'order_commission.py').read_text()
        with (ROOT/('.local/order-'+mode+'.log')).open('w') as log:
            subprocess.run(command,input=code,text=True,env=child,stdout=log,stderr=log,check=True,timeout=600)
    if mode=='install':
        with psycopg2.connect(**s) as db:
            after=snapshot(db)
            with db.cursor() as cur:
                cur.execute("SELECT state FROM ir_module_module WHERE name='ma2f_core'")
                assert cur.fetchone()==('installed',)
        for key in before:
            if key!='integration_configuration_sha256':assert before[key]==after[key],key
        print(json.dumps({'addonInstalled':True,'businessAndIdentityRecordsUnchanged':True,'ordersEnabled':False}))
    else:
        assert result_path.exists(),'Missing commissioning result'
        print(result_path.read_text())

if __name__=='__main__':
    try:main()
    except Exception as error:
        raise SystemExit('ORDER_MAINTENANCE_FAILED '+type(error).__name__+'; private log retained; no credentials logged')
