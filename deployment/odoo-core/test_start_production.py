import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('production_launcher',Path(__file__).with_name('start_production.py'))
launcher=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'psycopg2':types.SimpleNamespace()}):spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
 def test_exact_production_destination(self):
  c=launcher.settings('postgresql://odoo_core_prod:fictional@'+launcher.HOST+'/ma2f_odoo?sslmode=verify-full')
  self.assertEqual(c['dbname'],'ma2f_odoo');self.assertEqual(c['sslmode'],'verify-full')
 def test_wrong_target_and_credentials_rejected(self):
  good='postgresql://odoo_core_prod:fictional@'+launcher.HOST+'/ma2f_odoo?sslmode=verify-full'
  for uri in ['',good.replace('odoo_core_prod','postgres'),good.replace('ma2f_odoo','neondb'),good.replace('verify-full','require'),good.replace(launcher.HOST,'helium')]:
   with self.subTest(uri=uri),self.assertRaises(ValueError):launcher.settings(uri)
 def test_failure_redacts_database_exception(self):
  with patch.object(launcher,'settings',side_effect=ValueError('secret-password')):
   with self.assertRaises(SystemExit) as e:launcher.main()
  self.assertNotIn('secret-password',str(e.exception));self.assertIn('preflight failed',str(e.exception))

if __name__=='__main__':unittest.main()
