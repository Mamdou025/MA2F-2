import unittest
from compare_firestore_snapshots import compare


class ComparisonTest(unittest.TestCase):
    def test_extended_archive_scope_is_not_reported_as_new_business_data(self):
        prefix = 'projects/fixture/databases/(default)/documents/'
        def doc(path, value=1):
            return {'name': prefix + path, 'fields': {'n': {'integerValue': str(value)}}}
        old = {'project': 'fixture', 'counts': {'orders': 2}, 'excluded': {'backups': 'excluded'},
               'documents': [doc('orders/a'), doc('orders/b')]}
        new = {'project': 'fixture', 'documents': [doc('orders/a', 2), doc('orders/c'),
               doc('orders/a/lines/one'), doc('backups/one')]}
        result = compare(old, new)
        self.assertEqual(result['countsByRootCollection'], {'changed': {'orders': 1}, 'added': {'orders': 1},
                         'absentInNewSnapshot': {'orders': 1}, 'newlyCovered': {'backups': 1, 'orders': 1}})
        self.assertFalse(result['writesPerformed'])
        self.assertEqual(len(old['documents']), 2)


if __name__ == '__main__':
    unittest.main()
