import unittest
from integration_access import check_command_account

class Cursor:
    def __init__(self,results):self.results=iter(results)
    def execute(self,*args):self.current=next(self.results)
    def fetchone(self):return self.current
    def fetchall(self):return self.current

class OrderAccessTests(unittest.TestCase):
    def test_locked_before_commissioning(self):check_command_account(Cursor([[]]))
    def test_restricted_gateway(self):check_command_account(Cursor([[(12,True,True,1)],(12,),(True,),(False,)]),'12')
    def test_unconfigured_identity(self):
        with self.assertRaises(ValueError):check_command_account(Cursor([[(12,True,True,1)]]))
    def test_generic_writes_rejected(self):
        with self.assertRaises(ValueError):check_command_account(Cursor([[(12,True,True,1)],(12,),(True,),(True,)]),'12')
    def test_internal_user_rejected(self):
        with self.assertRaises(ValueError):check_command_account(Cursor([[(12,True,False,1)]]),'12')

if __name__=='__main__':unittest.main()
