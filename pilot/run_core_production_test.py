from pathlib import Path
import os,subprocess
ROOT=Path(__file__).resolve().parent.parent
assert str(ROOT).startswith('/mnt/c/')
os.environ['DOCKER_CONFIG']=str(ROOT/'pilot/.local/docker-cli')
command=['docker','compose','-f',str(ROOT/'pilot/compose.yaml'),'run','--rm','--no-deps','-T','-v',str(ROOT/'deployment/odoo-core/addons')+':/mnt/core-addons:ro','odoo','odoo','shell','-c','/etc/odoo/odoo.conf','-d','ma2f_core_test','--addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/core-addons','--no-http']
log=ROOT/'pilot/.local/core-production-test.log'
with log.open('w') as output:result=subprocess.run(command,input=(ROOT/'pilot/scripts/core_production_test.py').read_text(),text=True,stdout=output,stderr=output)
lines=log.read_text().splitlines();print('\n'.join(lines[-30:] if result.returncode else [s for s in lines if s.startswith('CORE_')]))
raise SystemExit(result.returncode)
