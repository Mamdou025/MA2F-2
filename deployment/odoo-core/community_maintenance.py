"""Explicit private maintenance: backup, install pinned OCA modules, verify invariants."""
import configparser
import datetime
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from start_production import settings, check
from community_sources import verified_addons_path, lock
import psycopg2

ROOT = Path(__file__).resolve().parent
MODULES = [m for item in lock().values() for m in item['modules']]

def snapshot(connection):
    with connection.cursor() as cur:
        result = {}
        for table in ['sale_order', 'account_move', 'account_payment', 'stock_move', 'stock_quant', 'mrp_production', 'res_partner', 'x_ma2f_sale_history']:
            cur.execute('SELECT count(*) FROM ' + table)
            result[table] = cur.fetchone()[0]
        cur.execute("SELECT id,login,active,share FROM res_users ORDER BY id")
        result['users_sha256'] = hashlib.sha256(repr(cur.fetchall()).encode()).hexdigest()
        cur.execute("SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY id),'')) FROM x_ma2f_sale_history t")
        result['history_digest'] = cur.fetchone()[0]
        cur.execute('SELECT id,name,email,phone,active FROM res_partner ORDER BY id')
        result['contacts_sha256'] = hashlib.sha256(repr(cur.fetchall()).encode()).hexdigest()
        cur.execute("SELECT key,value FROM ir_config_parameter WHERE key LIKE 'ma2f.integration.%%' OR key IN ('database.is_neutralized','ir_attachment.location','auth_signup.invitation_scope') ORDER BY key")
        result['integration_configuration_sha256'] = hashlib.sha256(repr(cur.fetchall()).encode()).hexdigest()
        cur.execute('SELECT name,state FROM ir_module_module WHERE name=ANY(%s)', (MODULES,))
        result['modules'] = dict(cur.fetchall())
    connection.rollback()
    return result

def main():
    assert sys.argv[1:] in [['backup'], ['install'], ['verify']]
    os.umask(0o077)
    connection_values = settings(getpass.getpass('Existing Odoo runtime connection: '))
    # Existing designated identities; this does not create or expand any account.
    os.environ['ODOO_ADMIN_USER_ID'] = '6'
    os.environ['ODOO_INTEGRATION_USER_ID'] = '11'
    check(connection_values)
    with psycopg2.connect(**connection_values) as connection:
        before = snapshot(connection)
    if sys.argv[1] == 'backup':
        directory = ROOT / '.local/community-backups' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        directory.mkdir(parents=True)
        backup_env = os.environ.copy()
        for key, value in {'PGHOST':connection_values['host'], 'PGPORT':'5432', 'PGUSER':connection_values['user'], 'PGPASSWORD':connection_values['password'], 'PGDATABASE':connection_values['dbname'], 'PGSSLMODE':'verify-full', 'PGSSLROOTCERT':connection_values['sslrootcert']}.items():
            backup_env[key] = value
        archive = directory / 'odoo.dump'
        assert shutil.which('pg_dump') and shutil.which('pg_restore'), 'PostgreSQL backup tools required'
        with (directory/'backup.log').open('w') as log:
            subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file', str(archive)], env=backup_env, stdout=log, stderr=log, check=True, timeout=300)
            subprocess.run(['pg_restore', '--list', str(archive)], stdout=log, stderr=log, check=True, timeout=30)
        evidence = {'snapshot':before, 'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(), 'bytes':archive.stat().st_size, 'archive':str(archive)}
        (directory/'manifest.json').write_text(json.dumps(evidence, indent=2))
        (ROOT/'.local/community-backup-latest.json').write_text(json.dumps(evidence, indent=2))
        print(json.dumps({'status':'backup_verified', 'bytes':evidence['bytes'], 'sha256':evidence['sha256'], 'counts':{k:v for k,v in before.items() if isinstance(v,int)}}))
        return
    source = verified_addons_path()
    backup = json.loads((ROOT/'.local/community-backup-latest.json').read_text())
    stable = lambda state: {k:v for k,v in state.items() if k != 'modules'}
    assert stable(before) == stable(backup['snapshot']), 'Production changed since backup; inspect before proceeding'
    archive = Path(backup['archive'])
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == backup['sha256']
    if sys.argv[1] == 'install':
        with tempfile.TemporaryDirectory(prefix='ma2f-community-') as directory:
            config = configparser.ConfigParser(interpolation=None)
            config['options'] = {'db_host':connection_values['host'], 'db_port':'5432', 'db_name':'ma2f_odoo', 'db_user':connection_values['user'], 'db_password':connection_values['password'], 'db_sslmode':'verify-full', 'list_db':'False', 'http_enable':'False', 'max_cron_threads':'0', 'data_dir':directory, 'addons_path':str(ROOT/'.local/odoo-source/addons')+','+source}
            cfg = Path(directory)/'odoo.conf'
            with cfg.open('w') as output: config.write(output)
            child = {k:v for k,v in os.environ.items() if not k.startswith(('PG','ODOO_')) and k != 'DATABASE_URL'}
            child['PGSSLROOTCERT'] = connection_values['sslrootcert']
            command = [str(ROOT/'.local/venv/bin/python'), str(ROOT/'.local/odoo-source/odoo-bin'), '-c', str(cfg), '-i', ','.join(MODULES), '--without-demo=True', '--stop-after-init', '--no-http']
            with (ROOT/'.local/community-install.log').open('w') as log:
                subprocess.run(command, env=child, stdout=log, stderr=log, check=True, timeout=600)
    with psycopg2.connect(**connection_values) as connection:
        after = snapshot(connection)
    assert stable(after) == stable(before), 'Business/account/configuration invariant changed'
    assert all(after['modules'].get(m) == 'installed' for m in MODULES), 'Incomplete module installation'
    check(connection_values)
    result = {'status':'verified', 'modules':after['modules'], 'business_records_unchanged':True, 'users_unchanged':True, 'integration_configuration_unchanged':True}
    (ROOT/'.local/community-install-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('COMMUNITY_MAINTENANCE_FAILED ' + type(error).__name__ + '; inspect the private log; no credentials printed')
        raise SystemExit(1)
