"""Import preserved sales into an Odoo read-only history list; no accounting postings."""
import sys
from native_maintenance import ROOT,run_native
if sys.argv[1:] not in [['preview'],['apply']]:raise SystemExit('Explicit preview/apply required')
mode=sys.argv[1]
code=r"""
import json,hashlib
from pathlib import Path
assert env.cr.dbname=='ma2f_odoo'
assert env.ref('ma2f_access.designated_admin').id==6
assert env.company.id==1
params=env['ir.config_parameter'].sudo()
assert params.get_param('ma2f.integration.business_enabled')=='false'
plan=json.loads(Path(INPUT_PATH).read_text())
assert plan['sourceSha256']==params.get_param('ma2f.integration.source_sha256')
assert 0<len(plan['rows'])<=10000
# Serialize this maintenance import; application users cannot create or edit history.
env.cr.execute("SELECT pg_advisory_xact_lock(583021940)")
def mark(name,record):
 env['ir.model.data'].create({'module':'ma2f_sales_history','name':name,'model':record._name,'res_id':record.id,'noupdate':True})
 return record
def ref(name):return env.ref('ma2f_sales_history.'+name,raise_if_not_found=False)
model=ref('model')
fields=[('x_name','Reference','char'),('x_source_id','Source ID','char'),('x_date','Sale date','date'),('x_customer','Customer (source)','char'),('x_packs','Packs','integer'),('x_price','Unit price, tax included (FCFA)','float'),('x_total','Recorded total, tax included (FCFA)','float'),('x_payment_mode','Payment status (source)','char'),('x_advance','Recorded advance (FCFA)','float'),('x_tax_status','Tax treatment','char'),('x_source_hash','Source record hash','char'),('x_archive_hash','Source archive hash','char'),('x_original','Original sale and linked receipts','text'),('x_review','Source review notes','text')]
if not model:
 assert not env['ir.model'].search([('model','=','x_ma2f_sale_history')])
 model=mark('model',env['ir.model'].create({'name':'MA2F sales history','model':'x_ma2f_sale_history','state':'manual','field_id':[(0,0,{'name':n,'field_description':label,'ttype':t,'state':'manual','readonly':True}) for n,label,t in fields]}))
assert model.model=='x_ma2f_sale_history'
if not ref('access'):
 mark('access',env['ir.model.access'].create({'name':'MA2F history administrator read','model_id':model.id,'group_id':env.ref('base.group_system').id,'perm_read':True,'perm_write':False,'perm_create':False,'perm_unlink':False}))
History=env[model.model].sudo()
existing={r.x_source_id:r for r in History.search([])}
assert len(existing)==History.search_count([])
seen=set();values=[];reused=0;total=0
for row in plan['rows']:
 s=row['original'];sid=row['sourceId']
 assert isinstance(sid,str) and sid and sid not in seen and s['id']==sid
 seen.add(sid)
 assert row['sourceSha256']==plan['sourceSha256']
 assert row['sourceHash']==hashlib.sha256(json.dumps(s,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 assert type(s['packs']) is int and type(s['prix']) is int and s['packs']>0 and s['prix']>0
 amount=s['packs']*s['prix'];assert amount<2**53
 total+=amount
 v={'x_name':s.get('numero') or sid,'x_source_id':sid,'x_date':s['date'],'x_customer':s['client'],'x_packs':s['packs'],'x_price':s['prix'],'x_total':amount,'x_payment_mode':s['mode'],'x_advance':s.get('avance',0),'x_tax_status':'Tax included — rate pending; invoice not posted','x_source_hash':row['sourceHash'],'x_archive_hash':plan['sourceSha256'],'x_original':json.dumps({'sale':s,'linkedReceipts':row['linkedPayments']},sort_keys=True,ensure_ascii=False,separators=(',',':')),'x_review':', '.join(row['reasons']) or False}
 if sid in existing:
  r=existing[sid]
  for key,value in v.items():
   actual=r[key]
   if key=='x_date':actual=str(actual)
   assert actual==value, 'Existing history differs; review required'
  reused+=1
 else:values.append(v)
History.create(values)
assert History.search_count([])==len(plan['rows'])
if not ref('list_view'):
 mark('list_view',env['ir.ui.view'].create({'name':'MA2F sales history list','model':model.model,'arch_base':'<list create="0" edit="0" delete="0" default_order="x_date desc, x_name desc"><field name="x_date"/><field name="x_name"/><field name="x_customer"/><field name="x_packs" sum="Packs"/><field name="x_price"/><field name="x_total" sum="Recorded total (FCFA)"/><field name="x_payment_mode"/><field name="x_tax_status"/></list>'}))
 mark('form_view',env['ir.ui.view'].create({'name':'MA2F sales history detail','model':model.model,'arch_base':'<form create="0" edit="0" delete="0"><sheet><div class="alert alert-info">Imported MA2F history. Recorded prices include tax; the rate is pending. This record is not a posted invoice and does not change stock.</div><group>'+''.join('<field name="'+n+'"/>' for n,label,t in fields if n!='x_original')+'</group><group><field name="x_original"/></group></sheet></form>'}))
 mark('search_view',env['ir.ui.view'].create({'name':'MA2F sales history search','model':model.model,'arch_base':'<search><field name="x_name"/><field name="x_customer"/><field name="x_date"/><group><filter name="customer" string="Customer" context="{&quot;group_by&quot;:&quot;x_customer&quot;}"/><filter name="month" string="Month" context="{&quot;group_by&quot;:&quot;x_date:month&quot;}"/></group></search>'}))
 action=mark('action',env['ir.actions.act_window'].create({'name':'Historique des ventes MA2F','res_model':model.model,'view_mode':'list,form','search_view_id':ref('search_view').id}))
 mark('menu',env['ir.ui.menu'].create({'name':'Historique des ventes MA2F','parent_id':env.ref('sale.sale_menu_root').id,'sequence':15,'action':'ir.actions.act_window,'+str(action.id),'group_ids':[(4,env.ref('base.group_system').id)]}))
# Verify the designated administrator can read, but cannot mutate source history.
admin=History.with_user(6).sudo(False)
assert admin.search_count([])==len(plan['rows'])
assert admin.has_access('read') and not admin.has_access('write') and not admin.has_access('create') and not admin.has_access('unlink')
result={'mode':MODE,'created':len(values),'reused':reused,'sales':len(plan['rows']),'recordedTotalFCFA':total,'actionId':ref('action').id,'financialOrStockPostings':0}
if MODE=='preview':env.cr.rollback()
else:
 env.cr.commit()
 env.registry.registry_invalidated=True
 env.registry.signal_changes()
Path(RESULT_PATH).write_text(json.dumps(result))
"""
code=code.replace('INPUT_PATH',repr(str(ROOT/'.local/sales-history-input.json'))).replace('RESULT_PATH',repr(str(ROOT/'.local/sales-history-result.json'))).replace('MODE',repr(mode))
run_native('sales-history',code)
