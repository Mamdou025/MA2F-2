"""Isolated OCA installation/acceptance runner. Never uses a production database."""
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = 'ma2f_community_upstream_' + uuid.uuid4().hex[:8] if sys.argv[1:] == ['upstream-test'] else 'ma2f_community_test'
assert str(ROOT).startswith('/mnt/c/')
assert sys.argv[1:] in [['init'], ['test'], ['upgrade'], ['upstream-test']]
os.environ['DOCKER_CONFIG'] = str(ROOT / 'pilot/.local/docker-cli')
lock = json.loads((ROOT / 'pilot/community-addons.lock.json').read_text())
addons = ['/usr/lib/python3/dist-packages/odoo/addons']
cmd = ['docker', 'compose', '-f', str(ROOT / 'pilot/compose.yaml'), 'run', '--rm', '--no-deps', '-T']
for repo, data in lock.items():
    folder = ROOT / 'pilot/.local/oca' / repo
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=folder, text=True).strip()
    assert actual == data['commit'], f'Unpinned source: {repo}'
    # Windows fetches may use CRLF; compare normalized source, not platform EOLs.
    dirty = subprocess.check_output(['git', '-c', 'core.autocrlf=true', 'status', '--porcelain'], cwd=folder, text=True)
    assert not dirty.strip(), f'Modified source: {repo}'
    cmd += ['-v', str(folder) + f':/mnt/oca/{repo}:ro']
    addons.append(f'/mnt/oca/{repo}')
cmd += ['odoo', 'odoo']
if sys.argv[1] == 'test':
    cmd += ['shell']
cmd += ['-c', '/etc/odoo/odoo.conf', '-d', DB, '--addons-path=' + ','.join(addons), '--no-http', '--log-level=info']
if sys.argv[1] != 'test':
    modules = ['sale_management', 'sale_stock', 'purchase_stock', 'mrp', 'l10n_sn', 'product_expiry', 'mrp_product_expiry', 'mrp_account', 'fleet', 'stock_fleet', 'maintenance', 'hr_expense']
    modules += [m for data in lock.values() for m in data['modules']]
    if sys.argv[1] == 'upstream-test':
        modules = ['stock_no_negative', 'auditlog', 'quality_control_oca', 'account_financial_report']
    cmd += ['-i' if sys.argv[1] in ['init', 'upstream-test'] else '-u', ','.join(modules), '--without-demo=True', '--stop-after-init']
    if sys.argv[1] == 'upstream-test':
        cmd += ['--test-enable', '--test-tags=/stock_no_negative,/auditlog,/quality_control_oca,/account_financial_report']
log_name = 'upstream-fresh' if sys.argv[1] == 'upstream-test' else sys.argv[1]
log = ROOT / f'pilot/.local/community-{log_name}.log'
program = (ROOT / 'pilot/scripts/community_acceptance.py').read_text() if sys.argv[1] == 'test' else None
with log.open('w') as output:
    output.write(f'COMMUNITY_DATABASE={DB}\n')
    output.flush()
    result = subprocess.run(cmd, input=program, text=True, stdout=output, stderr=output)
lines = log.read_text().splitlines()
exit_code = result.returncode
if exit_code == 0 and sys.argv[1] == 'test':
    recorded = json.loads((ROOT / 'pilot/.local/community-result.json').read_text())
    assert recorded['status'] == 'passed' and len(recorded['checks']) == 17
if exit_code == 0 and sys.argv[1] == 'upstream-test':
    passed = re.search(r'0 failed, 0 error\(s\) of ([1-9][0-9]*) tests', '\n'.join(lines))
    if not passed:
        exit_code = 1
        print('COMMUNITY_UPSTREAM_SUMMARY_MISSING_OR_FAILED')
print('\n'.join(lines[-35:] if exit_code else [s for s in lines if s.startswith('COMMUNITY_') or 'odoo.tests.result:' in s]))
print(f'COMMUNITY_{sys.argv[1].upper()}_EXIT={exit_code}')
raise SystemExit(exit_code)
