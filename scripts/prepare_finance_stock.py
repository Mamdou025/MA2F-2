import json,gzip,sys,collections,hashlib
from pathlib import Path
sys.path.insert(0,'scripts')
from prepare_customers_orders import decode,SHA
raw=Path('migration-private/business-source-20260908.json.gz').read_bytes()
if hashlib.sha256(raw).hexdigest()!=SHA:
 raise ValueError('SOURCE_CHECKSUM_MISMATCH')
s=json.loads(gzip.decompress(raw))
cols={}
for x in s['documents']:
 col=x['name'].split('/documents/')[1].split('/')[0]
 if col in ('ventes','recouvrements','production','mouvements_stock','depenses','versements','apports','livraisons','emballages'):
  cols.setdefault(col,[]).append(decode({'mapValue':{'fields':x.get('fields',{})}}))
from decimal import Decimal
D=lambda x:Decimal(str(x))
issues=[]
for v in cols['ventes']:
 if v.get('numero') is None:issues.append({'kind':'MISSING_SALE_NUMBER','id':v['id']})
sales={v['id']:v for v in cols['ventes']};recoveries=collections.defaultdict(lambda:Decimal(0))
for r in cols['recouvrements']:
 if r.get('venteId') in sales:recoveries[r['venteId']]+=D(r['montant'])
 else:issues.append({'kind':'RECOVERY_WITHOUT_MATCHED_SALE','id':r['id'],'sourceSaleId':r.get('venteId')})
analysis=[]
for v in sales.values():
 gross=D(v['packs'])*D(v['prix']);paid=recoveries[v['id']]
 advance=v.get('avance')
 cash=min(D(advance),gross) if advance is not None else max(Decimal(0),gross-paid) if v['mode']=='Payé' else Decimal(0)
 balance=gross-cash-paid
 if advance is not None and (D(advance)<0 or D(advance)>gross):issues.append({'kind':'ADVANCE_OUTSIDE_SALE','id':v['id']})
 if balance<0:issues.append({'kind':'NEGATIVE_SALE_BALANCE','id':v['id'],'amount':str(balance)})
 analysis.append({'id':v['id'],'gross':str(gross),'legacyCashAtSale':str(cash),'linkedRecoveries':str(paid),'legacyBalance':str(balance)})
movements=cols['mouvements_stock'];positions=collections.defaultdict(lambda:Decimal(0));units=collections.defaultdict(set)
for m in movements:
 unit=m.get('unite');product=m.get('produit');q=D(m['quantite'])
 if q<0:issues.append({'kind':'NEGATIVE_STOCK_QUANTITY','id':m['id']})
 src=m.get('emplacementSource');dst=m.get('emplacementDest')
 if not src and not dst:issues.append({'kind':'MISSING_STOCK_ENDPOINTS','id':m['id']})
 for place,sign in ((src,-1),(dst,1)):
  if place:positions[(place,product,unit)]+=sign*q;units[(place,product)].add(unit)
for pair,us in units.items():
 if len(us)>1:issues.append({'kind':'MIXED_STOCK_UNITS','place':pair[0],'product':pair[1],'units':sorted(us)})
report={'version':1,'sourceSha256':'82afd0419934a23a5d48ccd31615347ac5c1655ff93063ef6b19ff7b440cb548','activationAllowed':False,'records':cols,'saleAnalysis':analysis,'stockPositions':[{'place':p,'product':prod,'unit':u,'quantity':str(q)} for (p,prod,u),q in positions.items()],'issues':issues,'summary':{'counts':{k:len(v) for k,v in cols.items()},'issueCounts':dict(collections.Counter(i['kind'] for i in issues)),'stockUnits':dict(collections.Counter(m.get('unite') for m in movements)),'stockTypes':dict(collections.Counter(m.get('type') for m in movements)),'salesGross':str(sum((D(a['gross']) for a in analysis),Decimal(0))),'legacyCashAtSale':str(sum((D(a['legacyCashAtSale']) for a in analysis),Decimal(0))),'linkedRecoveries':str(sum(recoveries.values(),Decimal(0))),'allRecoveries':str(sum((D(r['montant']) for r in cols['recouvrements']),Decimal(0))),'legacyBalances':str(sum((D(a['legacyBalance']) for a in analysis),Decimal(0)))}}
with Path('migration-private/finance-stock-review-v2.json').open('x') as f:json.dump(report,f,ensure_ascii=False,allow_nan=False)
print(json.dumps(report['summary']))
