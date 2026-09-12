"""Private native ORM maintenance runner; never exposed through the application API."""
import configparser,getpass,json,os,re,subprocess,tempfile
from pathlib import Path
from start_production import settings
ROOT=Path(__file__).resolve().parent

def run_native(purpose,code):
    assert re.fullmatch(r'[a-z-]{1,50}',purpose)
    os.umask(0o077)
    values=settings(getpass.getpass('Odoo runtime connection: '))
    result_path=ROOT/('.local/'+purpose+'-result.json')
    result_path.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='ma2f-maintenance-') as directory:
        config=configparser.ConfigParser(interpolation=None)
        config['options']={'db_host':values['host'],'db_port':'5432','db_name':'ma2f_odoo','db_user':values['user'],'db_password':values['password'],'db_sslmode':'verify-full','list_db':'False','http_enable':'False','max_cron_threads':'0','data_dir':directory,'addons_path':str(ROOT/'.local/odoo-source/addons')}
        config_path=Path(directory)/'odoo.conf'
        with config_path.open('w') as f:config.write(f)
        child={k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k!='DATABASE_URL'}
        child['PGSSLROOTCERT']='/etc/ssl/certs/ca-certificates.crt'
        with (ROOT/('.local/'+purpose+'.log')).open('w') as log:
            result=subprocess.run([str(ROOT/'.local/venv/bin/python'),str(ROOT/'.local/odoo-source/odoo-bin'),'shell','-c',str(config_path),'--no-http'],input=code,text=True,env=child,stdout=log,stderr=log,timeout=180)
        if result.returncode or not result_path.exists():raise RuntimeError('Native maintenance validation failed; private log retained')
    print(result_path.read_text())
