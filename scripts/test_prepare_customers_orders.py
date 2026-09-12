import unittest
from prepare_customers_orders import prepare,decode

def val(x):
 if x is None:return {'nullValue':None}
 if isinstance(x,dict):return {'mapValue':{'fields':{k:val(v) for k,v in x.items()}}}
 if isinstance(x,list):return {'arrayValue':{'values':[val(v) for v in x]}}
 if isinstance(x,bool):return {'booleanValue':x}
 if isinstance(x,int):return {'integerValue':str(x)}
 return {'stringValue':x}
def fixture(clientId='c1'):
 c={'id':'c1','nom':'Client test','type':'detail','zone':'Test','tel':'000','prix':350}
 o={'id':'o1','numero':'CMD-1','date':'2026-09-01','clientId':clientId,'client':'Client test','tel':'000','zone':'Test','packs':30,'statut':'livree'}
 def doc(path,p):return {'name':'projects/ma2f-aquasachet/databases/(default)/documents/'+path,'fields':val(p)['mapValue']['fields']}
 return {'project':'ma2f-aquasachet','counts':{'clients':1,'commandes':1},'documents':[doc('clients/c1',c),doc('commandes/o1',o)]}
class ModelTests(unittest.TestCase):
 def test_exact_link(self):
  p=prepare(fixture());self.assertEqual(p['orders'][0]['customer_id'],'c1');self.assertFalse(p['activationAllowed'])
 def test_missing_never_linked_by_name_phone(self):
  p=prepare(fixture('deleted'));self.assertIsNone(p['orders'][0]['customer_id']);self.assertEqual(p['orders'][0]['source_customer_id'],'deleted');self.assertFalse(p['review']['proposals'][0]['approved'])
 def test_unlinked_stays_unlinked(self):
  p=prepare(fixture(None));self.assertEqual(p['orders'][0]['customer_link_state'],'unlinked')
 def test_duplicate_numbers_preserved(self):
  s=fixture();import copy
  second=copy.deepcopy(s['documents'][1]);second['name']=second['name'].replace('o1','o2');second['fields']['id']=val('o2');s['documents'].append(second);s['counts']['commandes']=2
  p=prepare(s);self.assertEqual(len(p['orders']),2);self.assertEqual(p['summary']['duplicateNumberRows'],2)
 def test_negative_packs_block_plan(self):
  s=fixture();s['documents'][1]['fields']['packs']=val(-1)
  with self.assertRaises(AssertionError):prepare(s)
 def test_unknown_firestore_type_rejected(self):
  with self.assertRaises(ValueError):decode({'unsupportedValue':1})
if __name__=='__main__':unittest.main()
