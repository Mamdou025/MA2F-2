"""Recreate exact source contacts; no invoices, payments or stock postings."""
import sys
from native_maintenance import ROOT,run_native
if sys.argv[1:] not in [['preview'],['apply']]:raise SystemExit('Explicit preview or apply required')
mode=sys.argv[1]
code=f'''
import json,hashlib
from pathlib import Path
assert env.cr.dbname=='ma2f_odoo'
assert env.ref('ma2f_access.designated_admin').id==6
assert env['res.company'].search_count([])==1 and env.company.id==1
params=env['ir.config_parameter'].sudo()
assert params.get_param('ma2f.integration.business_enabled')=='false'
p=Path({str(ROOT/'.local/history-contacts-input.json')!r})
assert p.stat().st_size<8000000
plan=json.loads(p.read_text())
assert plan['sourceSha256']==params.get_param('ma2f.integration.source_sha256')
assert len(plan['contacts'])<=10000
partners=env['res.partner'].with_context(tracking_disable=True,mail_create_nolog=True,mail_create_nosubscribe=True)
seen=set();created=0;reused=0;pending=[]
markers=env['ir.model.data'].search([('module','=','ma2f_history'),('model','=','res.partner')])
existing={{r.name:r.res_id for r in markers}}
existing_partners={{r.id:r for r in partners.browse(list(existing.values())).exists()}}
provenances={{r.key:r.value for r in params.search([('key','=like','ma2f.history.%')])}}
for c in plan['contacts']:
 assert isinstance(c['name'],str) and c['name'].strip()
 assert c['phone'] is False or isinstance(c['phone'],str)
 marker='customer_'+hashlib.sha256(json.dumps(c['key'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 assert marker==c['marker'] and marker not in seen
 assert c['sourceHash']==hashlib.sha256(json.dumps(c['original'],sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 assert c['name']==c['original']['client' if c['historicalOnly'] else 'nom']
 seen.add(marker)
 record=existing_partners.get(existing.get(marker))
 assert marker not in existing or record
 provenance=json.dumps({{'sourceSha256':plan['sourceSha256'],'sourceHash':c['sourceHash'],'key':c['key'],'historicalOnly':c['historicalOnly'],'original':c['original']}},sort_keys=True,ensure_ascii=False,separators=(',',':'))
 if record:
  assert record._name=='res.partner' and record.company_id.id==1
  assert record.name==c['name'] and (record.phone or False)==c['phone']
  assert provenances.get('ma2f.history.'+marker)==provenance
  reused+=1
 else:
  assert 'ma2f.history.'+marker not in provenances
  pending.append((c,marker,provenance))
  created+=1
new_partners=partners.create([{{'name':c['name'],'phone':c['phone'],'company_id':1,'customer_rank':1,'type':'contact'}} for c,marker,provenance in pending])
env['ir.model.data'].create([{{'module':'ma2f_history','name':marker,'model':'res.partner','res_id':record.id,'noupdate':True}} for record,(c,marker,provenance) in zip(new_partners,pending)])
params.create([{{'key':'ma2f.history.'+marker,'value':provenance}} for c,marker,provenance in pending])
assert created+reused==len(plan['contacts'])
result={{'mode':{mode!r},'contactsCreated':created,'contactsReused':reused,'historicalOnly':plan['historicalOnly'],'financialOrStockPostings':0}}
if {mode!r}=='preview':env.cr.rollback()
else:env.cr.commit()
Path({str(ROOT/'.local/history-contacts-result.json')!r}).write_text(json.dumps(result))
'''
run_native('history-contacts',code)
