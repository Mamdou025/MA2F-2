"""Exercise fail-closed entry points without credentials or business records."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MigrationPreflightTests(unittest.TestCase):
    def test_candidate_imports_require_apply_before_loading_data_or_database(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node is required to verify import entry points')
        for filename in ('import_customers_orders.mjs', 'import_finance_stock.mjs', 'import_cash.mjs'):
            with self.subTest(script=filename), tempfile.TemporaryDirectory() as directory:
                env = dict(os.environ, DATABASE_URL='postgresql://invalid.invalid/unreachable')
                result = subprocess.run([node, str(ROOT / 'scripts' / filename)],
                                        cwd=directory, env=env, capture_output=True, text=True, timeout=15)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('APPLY_REQUIRED', result.stderr)
                self.assertNotIn('MODULE_NOT_FOUND', result.stderr)
                self.assertFalse(list(Path(directory).iterdir()))

    def test_wrong_archive_is_rejected_before_decompression_even_with_optimization(self):
        for options in ([], ['-O']):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                private = Path(directory) / 'migration-private'
                private.mkdir()
                archive = private / 'business-source-20260908.json.gz'
                archive.write_bytes(b'wrong source; intentionally not gzip')
                env = dict(os.environ, PYTHONPATH=str(ROOT / 'scripts'))
                result = subprocess.run([sys.executable, *options, str(ROOT / 'scripts/prepare_finance_stock.py')],
                                        cwd=directory, env=env, capture_output=True, text=True, timeout=15)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('SOURCE_CHECKSUM_MISMATCH', result.stderr)
                self.assertEqual(list(private.iterdir()), [archive])
                self.assertEqual(archive.read_bytes(), b'wrong source; intentionally not gzip')


if __name__ == '__main__':
    unittest.main()
