import unittest
from production_preflight import connection_settings, inspect, MODULES


class Cursor:
    def __init__(self, privilege=False, signup='b2b'):
        self.results = iter([(privilege, False, False, False, False),
            [(name, 'installed') for name in MODULES],
            [('ir_attachment.location', 'db'), ('auth_signup.invitation_scope', signup),
             ('database.is_neutralized', 'true')], (0,), (0,)])
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, query, args=None):
        assert query.startswith('SELECT ')
        self.result = next(self.results)
    def fetchone(self): return self.result
    def fetchall(self): return self.result


class Connection:
    class info:
        ssl_in_use = True
    def __init__(self, **kwargs): self.cur = Cursor(**kwargs); self.rolled_back = False
    def set_session(self, **kwargs): assert kwargs == dict(readonly=True, autocommit=False)
    def cursor(self): return self.cur
    def rollback(self): self.rolled_back = True


class ProductionChecks(unittest.TestCase):
    def test_dedicated_tls_connection(self):
        c = connection_settings('postgresql://odoo_core_prod:test%40value@example.invalid/production?sslmode=verify-full')
        self.assertEqual(c['password'], 'test@value')
        self.assertIn('default_transaction_read_only=on', c['options'])

    def test_unsafe_connections_rejected(self):
        for url in ['postgresql://postgres:secret@example.invalid/prod?sslmode=verify-full',
                    'postgresql://odoo_core_prod:secret@helium/heliumdb?sslmode=verify-full',
                    'postgresql://odoo_core_prod:secret@example.invalid/prod?sslmode=require',
                    'postgresql://odoo_core_prod:secret@example.invalid/prod?sslmode=verify-full&sslmode=disable',
                    'postgresql://odoo_core_prod:secret@example.invalid:bad/prod?sslmode=verify-full']:
            with self.subTest(url=url), self.assertRaises(ValueError): connection_settings(url)

    def test_database_success_does_not_authorize_publication(self):
        c = Connection(); report = inspect(c)
        self.assertTrue(report['databaseChecksPassed'])
        self.assertFalse(report['readyForPublication'])
        self.assertTrue(c.rolled_back)

    def test_elevated_role_rejected(self):
        self.assertFalse(inspect(Connection(privilege=True))['databaseChecksPassed'])

    def test_public_signup_rejected(self):
        self.assertFalse(inspect(Connection(signup='b2c'))['databaseChecksPassed'])


if __name__ == '__main__': unittest.main()
