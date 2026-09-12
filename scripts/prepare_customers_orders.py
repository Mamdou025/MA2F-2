"""Prepare inactive customer/order tables from a pinned export, without inferred links."""
import json,gzip,hashlib,math
from pathlib import Path
from datetime import date
from collections import Counter
SHA='82afd0419934a23a5d48ccd31615347ac5c1655ff93063ef6b19ff7b440cb548'
def decode(v):
 if not isinstance(v,dict) or len(v)!=1:raise ValueError('Invalid typed value')
 k,x=next(iter(v.items()))
 if k=='mapValue':return {a:decode(b) for a,b in x.get('fields',{}).items()}
 if k=='arrayValue':return [decode(b) for b in x.get('values',[])]
 if k=='integerValue':return int(x)
 if k=='doubleValue':
  if type(x) not in (int,float) or not math.isfinite(x):raise ValueError('Nonfinite number')
  return x
 if k in ('stringValue','timestampValue','referenceValue','bytesValue'):return x
 if k=='booleanValue':return x
 if k=='nullValue':return None
 if k=='geoPointValue':return x
 raise ValueError('Unsupported value type')
def prepare(source):
 assert source['project']=='ma2f-aquasachet'
 records={}
 for d in source['documents']:
  path=d['name'].split('/documents/',1)[1]
  if path.split('/')[0] not in ('clients','commandes','business','meta'):continue
  assert path not in records
  records[path]=decode({'mapValue':{'fields':d.get('fields',{})}})
 clients=[];orders=[];issues=[];proposals=[]
 for path,p in records.items():
  if not path.startswith('clients/'):continue
  assert p['id']==path.split('/')[1] and p['id'] and isinstance(p['nom'],str) and p['nom'].strip()
  assert all(isinstance(p[k],str) for k in ('type','zone','tel'))
  assert type(p['prix']) in (int,float) and math.isfinite(p['prix']) and p['prix']>=0
  clients.append({'id':p['id'],'name':p['nom'],'customer_type':p['type'],'zone':p['zone'],'phone':p['tel'],'price':p['prix'],'source_path':path,'payload':p})
 ids={c['id'] for c in clients}
 for path,p in records.items():
  if not path.startswith('commandes/'):continue
  assert p['id']==path.split('/')[1] and p['id']
  assert isinstance(p['numero'],str) and p['numero']
  assert date.fromisoformat(p['date']).isoformat()==p['date']
  assert p['statut'] in ('en_attente','assignee','en_livraison','livree','annulee')
  assert type(p['packs']) in (int,float) and math.isfinite(p['packs']) and p['packs']>0 and int(p['packs'])==p['packs']
  assert all(isinstance(p[k],str) for k in ('client','tel','zone'))
  original=p.get('clientId')
  assert original is None or isinstance(original,str)
  state='unlinked' if not original else 'resolved' if original in ids else 'missing'
  orders.append({'id':p['id'],'number':p['numero'],'order_date':p['date'],'customer_id':original if state=='resolved' else None,'source_customer_id':original,'customer_link_state':state,'customer_name':p['client'],'phone':p['tel'],'zone':p['zone'],'packs':int(p['packs']),'status':p['statut'],'source_path':path,'payload':p})
  if state=='missing':
   issues.append({'kind':'MISSING_CLIENT','orderId':p['id'],'sourceClientId':original})
   matches=[c for c in clients if c['name'].strip().casefold()==p['client'].strip().casefold() and c['phone'] and c['phone']==p['tel']]
   if len(matches)==1:proposals.append({'orderId':p['id'],'sourceClientId':original,'candidateClientId':matches[0]['id'],'evidence':'unique_exact_name_phone','approved':False})
 numbers=Counter(o['number'] for o in orders)
 for o in orders:
  if numbers[o['number']]>1:issues.append({'kind':'DUPLICATE_ORDER_NUMBER','orderId':o['id'],'number':o['number']})
 legacy=records.get('business/data',{}).get('clients',[])
 for p in legacy:issues.append({'kind':'LEGACY_CLIENT_REVIEW','sourcePath':'business/data','sourceClientId':p.get('id')})
 assert len(clients)==source['counts']['clients'] and len(orders)==source['counts']['commandes']
 return {'version':1,'archiveSha256':SHA,'activationAllowed':False,'clients':clients,'orders':orders,'review':{'issues':issues,'proposals':proposals,'legacyClients':legacy},'summary':{'clients':len(clients),'orders':len(orders),'resolved':sum(o['customer_link_state']=='resolved' for o in orders),'missing':sum(o['customer_link_state']=='missing' for o in orders),'unlinked':sum(o['customer_link_state']=='unlinked' for o in orders),'duplicateNumberGroups':sum(n>1 for n in numbers.values()),'duplicateNumberRows':sum(n for n in numbers.values() if n>1),'proposals':len(proposals),'legacyClients':len(legacy)}}
if __name__=='__main__':
 raw=Path('migration-private/business-source-20260908.json.gz').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==SHA
 plan=prepare(json.loads(gzip.decompress(raw)))
 with Path('migration-private/customers-orders-plan.json').open('x') as f:json.dump(plan,f,ensure_ascii=False,allow_nan=False)
 print(json.dumps(plan['summary']))
