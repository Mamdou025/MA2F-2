"""Native scenario adapter; private fictitious DB, complete business rollback."""
from pathlib import Path
import os
import subprocess
import json

P = Path(__file__).resolve().parent
N = P / '.local/native'
assert subprocess.check_output(['git', '-C', str(N / 'odoo-source'), 'rev-parse', 'HEAD'], text=True).strip() == '8da213dc6785e097f2558dc2d648b588957786a1'
child = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'ODOO_')) and k != 'DATABASE_URL'}
bootstrap = (P / 'scripts/bootstrap.py').read_text()
fixtures = bootstrap[bootstrap.index('unit = env.ref('):bootstrap.index('# All ratios and prices')]
scenario = (P / 'scripts/business_scenario.py').read_text()
assert scenario.count('assert env.cr.dbname == "ma2f_pilot"') == 1
scenario = scenario.replace('assert env.cr.dbname == "ma2f_pilot"', 'assert env.cr.dbname == "ma2f_native_pilot"').replace("Path('/run/ma2f/business-result.json')", 'Path(' + repr(str(N / 'native-business-result.json')) + ')')
code = '''from odoo import Command
from pathlib import Path
assert env.cr.dbname == 'ma2f_native_pilot'
company=env.company
params=env['ir.config_parameter'].sudo()
models=['product.product','stock.move','mrp.production','account.move','res.partner']
before={m:env[m].with_context(active_test=False).search_count([]) for m in models}
try:
 company.write({'country_id':env.ref('base.sn').id,'currency_id':env.ref('base.XOF').id})
 env['account.chart.template'].try_loading('sn',company,install_demo=False,force_create=False)
 params.set_param('ma2f.pilot_only','true')
'''
code += chr(10).join(' ' + line for line in fixtures.splitlines()) + chr(10)
code += ' exec(compile(' + repr(scenario) + ",'native_business','exec'))" + chr(10)
code += '''finally:
 env.cr.rollback()
env.invalidate_all()
assert all(env[m].with_context(active_test=False).search_count([])==n for m,n in before.items()), 'Rollback changed counts'
print('NATIVE_BUSINESS_ROLLBACK_VERIFIED')
'''
with (N / 'native-business.log').open('w') as log:
    result = subprocess.run([str(N / 'venv/bin/python'), str(N / 'odoo-source/odoo-bin'), 'shell', '-c', str(N / 'odoo.conf'), '-d', 'ma2f_native_pilot', '--no-http'], env=child, input=code, text=True, stdout=log, stderr=subprocess.STDOUT, timeout=180)
assert result.returncode == 0, 'Business scenario failed; private log retained'
report = json.loads((N / 'native-business-result.json').read_text())
assert report['status'] == 'passed'
print(json.dumps(report))
print('NATIVE_BUSINESS_ROLLBACK_VERIFIED')
