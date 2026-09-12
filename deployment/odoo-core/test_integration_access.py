import unittest
from integration_access import check_accounts


class Cursor:
    def __init__(self, results):
        self.results = iter(results)
    def execute(self, query, params=None):
        assert query.lstrip().startswith('SELECT ')
        self.result = next(self.results)
    def fetchall(self): return self.result
    def fetchone(self): return self.result


class AccountPolicyTests(unittest.TestCase):
    def test_designated_administrator(self):
        check_accounts(Cursor([[(9, 'fallmamadou151@gmail.com')], (9,), (True,)]), configured_admin_id='9')
    def test_admin_remains_inactive_until_activation(self):
        check_accounts(Cursor([[]]), configured_admin_id='9')
    def test_admin_requires_exact_identity_marker_and_permission(self):
        for results in [[[(9, 'different@example.invalid')]],
                        [[(9, 'fallmamadou151@gmail.com')], None],
                        [[(9, 'fallmamadou151@gmail.com')], (9,), (False,)],
                        [[(9, 'fallmamadou151@gmail.com'), (10, 'other')], (9,), (True,)]]:
            with self.subTest(results=results), self.assertRaises(ValueError):
                check_accounts(Cursor(results), configured_admin_id='9')
    def test_admin_not_implicitly_enabled(self):
        with self.assertRaises(ValueError):
            check_accounts(Cursor([[(9, 'fallmamadou151@gmail.com')]]))
    def test_admin_and_technical_account_can_coexist(self):
        check_accounts(Cursor([[(7, 'ma2f.integration'), (9, 'fallmamadou151@gmail.com')],
            (9,), (True,), (7,), (False,), (False,)]), '7', '9')
    def test_one_identity_cannot_be_both(self):
        with self.assertRaises(ValueError):
            check_accounts(Cursor([]), '9', '9')
    def test_default_locked_mode(self):
        check_accounts(Cursor([[]]))
    def test_publish_before_account_activation(self):
        check_accounts(Cursor([[]]), '7')
    def test_verified_read_only_account(self):
        check_accounts(Cursor([[(7, 'ma2f.integration')], (7,), (False,), (False,)]), '7')
    def test_no_implicit_activation(self):
        with self.assertRaises(ValueError):
            check_accounts(Cursor([[(7, 'ma2f.integration')]]))
    def test_unknown_or_additional_account_denied(self):
        for rows in [[(8, 'ma2f.integration')], [(7, 'another-login')],
                     [(7, 'ma2f.integration'), (8, 'another-login')]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                check_accounts(Cursor([rows]), '7')
    def test_admin_or_writer_denied(self):
        for results in [[[(7, 'ma2f.integration')], None],
                        [[(7, 'ma2f.integration')], (7,), (True,)],
                        [[(7, 'ma2f.integration')], (7,), (False,), (True,)]]:
            with self.subTest(results=results), self.assertRaises(ValueError):
                check_accounts(Cursor(results), '7')
    def test_invalid_config_and_builtin_admin_denied(self):
        for value in ['', '0', '1', '2', '-1', '7,8', '7.0']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                check_accounts(Cursor([[(int(value) if value.isdigit() else 7, 'ma2f.integration')]]), value)


if __name__ == '__main__': unittest.main()
