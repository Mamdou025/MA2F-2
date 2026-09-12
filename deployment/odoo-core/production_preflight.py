"""Read-only production checks using a dedicated runtime credential, never DATABASE_URL.

Run with the installed Odoo Python environment. No credentials or database rows
are printed. Passing these checks does not authorize publication or data cutover.
"""
import json
import os
from urllib.parse import parse_qs, unquote, urlsplit

MODULES = {'stock', 'purchase', 'sale_management', 'mrp', 'account', 'l10n_sn',
           'product_expiry', 'mrp_product_expiry', 'mrp_account'}


def connection_settings(uri):
    try:
        parts = urlsplit(uri)
        query = parse_qs(parts.query, strict_parsing=True)
        port = parts.port or 5432
        host = parts.hostname
        user = unquote(parts.username or '')
        password = unquote(parts.password or '')
        database = unquote(parts.path.lstrip('/'))
    except (ValueError, TypeError):
        raise ValueError('INVALID_RUNTIME_CONNECTION') from None
    if (parts.scheme not in {'postgres', 'postgresql'} or not host or not password
            or not database or '/' in database or parts.fragment
            or host in {'helium', 'localhost', '127.0.0.1', '::1'}
            or database in {'heliumdb', 'ma2f_native_pilot'}
            or user != 'odoo_core_prod' or query != {'sslmode': ['verify-full']}):
        raise ValueError('DEDICATED_TLS_PRODUCTION_CONNECTION_REQUIRED')
    return dict(host=host, port=port, user=user, password=password, dbname=database,
                sslmode='verify-full', connect_timeout=10,
                options='-c default_transaction_read_only=on -c statement_timeout=10000')


def inspect(connection):
    connection.set_session(readonly=True, autocommit=False)
    checks = {}
    with connection.cursor() as cursor:
        cursor.execute('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')
        checks['restricted_runtime_role'] = cursor.fetchone() == (False,) * 5
        checks['encrypted_connection'] = connection.info.ssl_in_use
        cursor.execute('SELECT name,state FROM ir_module_module WHERE name=ANY(%s)', (sorted(MODULES),))
        states = dict(cursor.fetchall())
        checks['required_modules'] = all(states.get(name) == 'installed' for name in MODULES)
        cursor.execute('SELECT key,value FROM ir_config_parameter WHERE key=ANY(%s)',
                       (['ir_attachment.location', 'auth_signup.invitation_scope', 'database.is_neutralized'],))
        params = dict(cursor.fetchall())
        checks['attachments_in_sql'] = params.get('ir_attachment.location') == 'db'
        checks['public_signup_disabled'] = params.get('auth_signup.invitation_scope') == 'b2b'
        checks['neutralized_until_cutover'] = params.get('database.is_neutralized') == 'true'
        cursor.execute("SELECT count(*) FROM ir_attachment WHERE store_fname IS NOT NULL AND store_fname <> ''")
        checks['no_external_filestore_dependencies'] = cursor.fetchone() == (0,)
        cursor.execute('SELECT count(*) FROM res_users WHERE active AND NOT share')
        active_internal = cursor.fetchone()[0]
        checks['accounts_locked_for_launch'] = active_internal == 0
    connection.rollback()
    return {'databaseChecks': checks, 'databaseChecksPassed': all(checks.values()),
            'activeInternalAccountCount': active_internal, 'readyForPublication': False,
            'pending': ['designated administrator and API permission verification',
                        'production restore and redeployment test']}


def main():
    try:
        uri = os.environ.get('ODOO_PRODUCTION_RUNTIME_URL')
        if not uri:
            raise ValueError('ODOO_PRODUCTION_RUNTIME_URL_REQUIRED')
        settings = connection_settings(uri)
    except ValueError as error:
        print(json.dumps({'status': 'blocked', 'code': str(error)}))
        return 1
    try:
        import psycopg2
        connection = psycopg2.connect(**settings)
        try:
            result = inspect(connection)
        finally:
            connection.close()
    except Exception:
        # Database exceptions can contain credentials, hostnames or data; do not print them.
        print(json.dumps({'status': 'blocked', 'code': 'PRODUCTION_DATABASE_CHECK_FAILED'}))
        return 1
    print(json.dumps(result))
    return 0 if result['databaseChecksPassed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
