"""Private Replit native pilot. Never serves HTTP or uses the app database."""
import argparse
import configparser
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
NATIVE = ROOT / '.local' / 'native'
REVISION = '8da213dc6785e097f2558dc2d648b588957786a1'
MODULES = 'ma2f_pilot_commands,product_expiry,mrp_product_expiry,mrp_account,l10n_sn'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['version', 'init', 'verify'])
    action = parser.parse_args().action
    source = NATIVE / 'odoo-source'
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != REVISION:
        raise RuntimeError('Unexpected Odoo source revision')
    config = configparser.ConfigParser()
    config.read(NATIVE / 'odoo.conf')
    expected = {'db_host': '/tmp/ma2f-odoo-native-socket', 'db_port': '55432',
                'db_user': 'odoo_native', 'db_name': 'ma2f_native_pilot', 'list_db': 'False'}
    if any(config['options'].get(k) != v for k, v in expected.items()):
        raise RuntimeError('Refusing configuration outside the isolated native pilot')
    # Odoo 19 environment values can override config. Do not inherit app secrets.
    child_env = {k: v for k, v in os.environ.items()
                 if not k.startswith(('PG', 'ODOO_')) and k != 'DATABASE_URL'}
    command = [str(NATIVE / 'venv/bin/python'), str(source / 'odoo-bin')]
    if action == 'version':
        command += ['--version']
    else:
        if action == 'verify':
            command += ['shell']
        command += ['-c', str(NATIVE / 'odoo.conf'), '-d', 'ma2f_native_pilot', '--no-http']
        if action == 'init':
            command += ['-i', MODULES, '--without-demo=True', '--stop-after-init']
    code = None
    if action == 'verify':
        code = """import json
assert env.cr.dbname == 'ma2f_native_pilot'
names = ['stock','purchase','sale_management','mrp','account','l10n_sn','ma2f_pilot_commands']
states = {m.name:m.state for m in env['ir.module.module'].search([('name','in',names)])}
assert all(states.get(n)=='installed' for n in names), states
env.cr.execute('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')
assert env.cr.fetchone()[0] is False
env.cr.rollback()
print(json.dumps({'status':'native_modules_verified','modules':states,'superuser':False,'http':False}))
"""
    subprocess.run(command, env=child_env, cwd=ROOT.parent, input=code, text=True, check=True)


if __name__ == '__main__':
    main()
