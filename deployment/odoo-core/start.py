"""Start the existing neutralized Odoo development database; never bootstrap it."""
import configparser
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
REVISION = '8da213dc6785e097f2558dc2d648b588957786a1'


def main():
    if os.environ.get('REPLIT_DEPLOYMENT') == '1':
        raise SystemExit('Production startup is blocked: configure and verify a dedicated production database and administrator first.')
    config_path = ROOT / '.local/odoo.conf'
    config = configparser.ConfigParser(interpolation=None)
    config.read(config_path)
    expected = {'db_host': 'helium', 'db_name': 'heliumdb', 'db_user': 'odoo_core_dev',
                'list_db': 'False', 'workers': '0', 'max_cron_threads': '0'}
    if not config.has_section('options') or any(config['options'].get(k) != v for k, v in expected.items()):
        raise SystemExit('Expected the initialized, restricted Odoo development configuration.')
    revision = subprocess.check_output(['git', '-C', str(ROOT / '.local/odoo-source'), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != REVISION:
        raise SystemExit('Odoo source revision does not match the verified installation.')
    child = {k: v for k, v in os.environ.items()
             if not k.startswith(('PG', 'ODOO_')) and k != 'DATABASE_URL'}
    command = [str(ROOT / '.local/venv/bin/python'), str(ROOT / '.local/odoo-source/odoo-bin'),
               '-c', str(config_path), '--http-interface=0.0.0.0', '--http-port=5000',
               '--workers=0', '--max-cron-threads=0', '--no-database-list']
    os.chdir(ROOT)
    os.execve(command[0], command, child)


if __name__ == '__main__':
    main()
