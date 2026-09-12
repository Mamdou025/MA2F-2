import gzip,hashlib,json,sys
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).parent))
from prepare_customers_orders import decode
SHA='82afd0419934a23a5d48ccd31615347ac5c1655ff93063ef6b19ff7b440cb548'
raw=Path('migration-private/business-source-20260908.json.gz').read_bytes()
assert hashlib.sha256(raw).hexdigest()==SHA
archive=json.loads(gzip.decompress(raw))
docs={d['name'].split('/documents/')[1]:decode({'mapValue':{'fields':d['fields']}}) for d in archive['documents']}
r=json.loads(Path('migration-private/finance-stock-review-v2.json').read_text())
assert r['sourceSha256']==SHA
records=r['records']; events=[]; issues=[]
for kind,direction in [('depenses',-1),('apports',1),('versements',-1)]:
 for row in records[kind]:
  assert isinstance(row.get('id'),str) and row['id']
  amount=Decimal(str(row['montant']))
  assert amount.is_finite() and amount>=0
  from datetime import date
  date.fromisoformat(row['date'])
  assert docs[kind+'/'+row['id']]==row
  events.append({'kind':kind,'id':row['id'],'date':row['date'],'amount':str(amount),'direction':direction,'mode':row.get('mode'),'payload':row})
  if kind=='depenses' and not row.get('mode'):issues.append({'kind':'MISSING_EXPENSE_PAYMENT_MODE','id':row['id']})
meta=docs['meta/data']; opening={p:docs[p].get('params',docs[p]).get('soldeOuverture',0) for p in ['meta/data','params/global','business/data']}
# Preserve legacy deduplication exactly; these are review candidates, not accounting entries.
expenses=records['depenses']; extra=[]
for row in meta.get('vehiculeOps',[]):
 category='Carburant véhicule' if row['type']=='Carburant' else 'Maintenance véhicule'
 if not any(d['date']==row['date'] and d['montant']==row['montant'] and d.get('categorie')==category for d in expenses):extra.append(Decimal(str(row['montant'])))
for row in meta.get('maintenance',[]):
 if row['cout']>0 and not any(d['date']==row['date'] and d['montant']==row['cout'] and d.get('categorie')=='Maintenance machine' for d in expenses):extra.append(Decimal(str(row['cout'])))
totals={k:str(sum((Decimal(e['amount']) for e in events if e['kind']==k),Decimal(0))) for k in ['depenses','apports','versements']}
base=Decimal(r['summary']['legacyCashAtSale'])+Decimal(r['summary']['allRecoveries'])+Decimal(totals['apports'])-Decimal(totals['depenses'])-Decimal(totals['versements'])-sum(extra,Decimal(0))
report={'sourceSha256':SHA,'activationAllowed':False,'events':events,'issues':issues,'openingBySource':opening,'totals':totals,'extraLegacyExpenses':str(sum(extra,Decimal(0))),'balanceScenarios':{p:str(base+Decimal(str(v))) for p,v in opening.items()},'legacyDatabase':{**records,'params':meta.get('params',{}),'maintenance':meta.get('maintenance',[]),'vehiculeOps':meta.get('vehiculeOps',[])},'limitations':['Snapshot only; no live cutover','Purchase receipts not directly deducted by legacy cash helper; expense coverage needs review','Legacy business/data opening differs from matching meta/data and params/global','Unmatched recoveries included as in legacy cash calculation; not certified cash or accounting']}
Path('migration-private/cash-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'status':'cash_prepared','counts':{k:len(records[k]) for k in totals},'totals':totals,'openingBySource':opening,'balanceScenarios':report['balanceScenarios'],'missingExpenseMode':len(issues),'extraLegacyExpenses':report['extraLegacyExpenses']}))
