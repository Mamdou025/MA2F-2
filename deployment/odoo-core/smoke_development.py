"""Local HTTP lifecycle check against the dedicated, locked development Odoo."""
import configparser
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parent
private = root / '.local'
config = configparser.ConfigParser(interpolation=None)
config.read(private / 'odoo.conf')
assert config['options']['db_host'] == 'helium'
assert config['options']['db_user'] == 'odoo_core_dev'
assert config['options']['http_interface'] == '127.0.0.1'
assert json.loads((private/'bootstrap-result.json').read_text())['status'] == 'passed'
child = {k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k != 'DATABASE_URL'}
with (private/'http-smoke.log').open('w') as log:
    process = subprocess.Popen([str(private/'venv/bin/python'), str(private/'odoo-source/odoo-bin'), '-c',str(private/'odoo.conf')],env=child,stdout=log,stderr=log)
    try:
        deadline = time.monotonic()+90
        while True:
            if process.poll() is not None:
                raise RuntimeError('Odoo exited; inspect private HTTP log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:18069/web/login',timeout=5) as response:
                    assert response.status == 200
                    assert b'name="login"' in response.read()
                break
            except (urllib.error.URLError,TimeoutError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)
        data = json.dumps({'jsonrpc':'2.0','method':'call','params':{'db':'heliumdb','login':'admin','password':'admin'},'id':1}).encode()
        request = urllib.request.Request('http://127.0.0.1:18069/web/session/authenticate',data=data,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=15) as response:
            result = json.load(response)
        assert 'error' in result and not result.get('result',{}).get('uid')
        assert result['error']['data']['name'] == 'odoo.exceptions.AccessDenied'
        report = {'status':'passed','environment':'development','loginHttp':200,'defaultAdminDenied':True,'listener':'127.0.0.1:18069','production':False}
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    report['serverStopped'] = True
    (private/'http-smoke-result.json').write_text(json.dumps(report))
    print(json.dumps(report))
