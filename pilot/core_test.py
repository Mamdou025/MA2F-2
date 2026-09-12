"""Isolated native tests; no real MA2F records and no published ports."""
from pathlib import Path
import os,subprocess,sys
ROOT=Path(__file__).resolve().parent.parent
assert str(ROOT).startswith('/mnt/c/')
assert sys.argv[1:] in [['init'],['upgrade']]
os.environ['DOCKER_CONFIG']=str(ROOT/'pilot/.local/docker-cli')
base=['docker','compose','-f',str(ROOT/'pilot/compose.yaml')]
subprocess.run(['docker','stop','ma2f-odoo-pilot-gateway-1','ma2f-odoo-pilot-odoo-1'],check=True,stdout=subprocess.DEVNULL)
flag='-i' if sys.argv[1]=='init' else '-u'
command=base+['run','--rm','--no-deps','-T','-v',str(ROOT/'deployment/odoo-core/addons')+':/mnt/core-addons:ro','odoo','odoo','-c','/etc/odoo/odoo.conf','-d','ma2f_core_test','--addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/core-addons',flag,'ma2f_core','--without-demo=True','--stop-after-init','--no-http']
log=ROOT/'pilot/.local/core-init.log'
with log.open('w') as output: result=subprocess.run(command,stdout=output,stderr=output)
print('CORE_NATIVE_INIT_OK' if result.returncode==0 else 'CORE_NATIVE_INIT_FAILED')
if result.returncode: print('\n'.join(log.read_text().splitlines()[-20:]))
raise SystemExit(result.returncode)
