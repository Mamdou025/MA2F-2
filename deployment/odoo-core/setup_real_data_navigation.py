"""Reversible native navigation/report configuration. Never creates business entries."""
import sys
from native_maintenance import ROOT, run_native

if sys.argv[1:] not in [['preview'], ['apply']]:
    raise SystemExit('Explicit preview/apply required')

code = r'''
import json
from pathlib import Path
from lxml import etree
assert env.cr.dbname == 'ma2f_odoo' and env.company.id == 1
assert env.ref('ma2f_access.designated_admin').id == 6
assert env['ir.config_parameter'].sudo().get_param('ma2f.integration.business_enabled') == 'false'
env.cr.execute('SELECT pg_advisory_xact_lock(583021940)')
params = env['ir.config_parameter'].sudo()
namespace = 'ma2f_navigation'
def upsert(key, model, values):
    record = env.ref(namespace+'.'+key, raise_if_not_found=False)
    if record:
        assert record._name == model
        record.write(values)
    else:
        record = env[model].create(values)
        env['ir.model.data'].create({'module':namespace,'name':key,'model':model,'res_id':record.id,'noupdate':True})
    return record
def backup(record, values):
    key = namespace+'.before.'+record._name+'.'+str(record.id)
    if not params.get_param(key):
        old = record.read(list(values))[0]
        params.set_param(key, json.dumps(old))
    record.write(values)
business_models = ['sale.order','account.move','account.payment','stock.move','stock.quant','mrp.production']
before = {m:env[m].search_count([]) for m in business_models}
history = env['x_ma2f_sale_history'].with_user(6).sudo(False)
count = history.search_count([])
total = history._read_group([], [], ['x_total:sum'])[0][0]
assert count == 1048 and total == 15339780
history_action = env.ref('ma2f_sales_history.action')
history_menu = env.ref('ma2f_sales_history.menu')
backup(history_menu, {'sequence':0,'name':'Ventes MA2F — historique importé'})
backup(history_action, {'name':'Ventes MA2F — historique importé (09/09/2026)'})
backup(env.ref('sale.sale_menu_root'), {'action':'ir.actions.act_window,'+str(history_action.id)})
graph = upsert('history_graph','ir.ui.view',{'name':'MA2F actual recorded sales graph','model':history._name,'arch_base':'<graph string="Ventes enregistrées TTC (FCFA) — historique importé" type="bar" sample="0"><field name="x_date" interval="month"/><field name="x_total" type="measure"/></graph>'})
pivot = upsert('history_pivot','ir.ui.view',{'name':'MA2F actual recorded sales pivot','model':history._name,'arch_base':'<pivot string="Ventes enregistrées TTC (FCFA) — historique importé" sample="0"><field name="x_date" interval="month" type="row"/><field name="x_total" type="measure"/><field name="x_packs" type="measure"/></pivot>'})
report = upsert('history_report','ir.actions.act_window',{'name':'Rapport MA2F — historique importé (09/09/2026)','res_model':history._name,'view_mode':'pivot,graph,list,form','search_view_id':env.ref('ma2f_sales_history.search_view').id,'context':"{'create':False,'edit':False,'delete':False}"})
for sequence, view in enumerate([pivot, graph, env.ref('ma2f_sales_history.list_view'), env.ref('ma2f_sales_history.form_view')]):
    upsert('report_view_'+view.type,'ir.actions.act_window.view',{'act_window_id':report.id,'view_mode':view.type,'view_id':view.id,'sequence':sequence})
upsert('report_menu','ir.ui.menu',{'name':'Rapport MA2F — données importées','parent_id':env.ref('sale.sale_menu_root').id,'sequence':1,'action':'ir.actions.act_window,'+str(report.id),'group_ids':[(6,0,[env.ref('base.group_system').id])]})
# Unpublish the four built-in template dashboards, retaining their data/configuration.
dashboards = []
for xid in ['spreadsheet_dashboard_account.dashboard_invoicing','spreadsheet_dashboard_sale.spreadsheet_dashboard_sales','spreadsheet_dashboard_sale.spreadsheet_dashboard_product','spreadsheet_dashboard_stock_account.spreadsheet_dashboard_warehouse_metrics']:
    dashboard = env.ref(xid)
    backup(dashboard, {'is_published':False})
    dashboards.append(dashboard.id)
for xid in ['spreadsheet_dashboard.spreadsheet_dashboard_menu_root','spreadsheet_dashboard.spreadsheet_dashboard_menu_dashboard']:
    backup(env.ref(xid), {'action':'ir.actions.act_window,'+str(report.id),'name':'Rapports MA2F','group_ids':[(6,0,[env.ref('base.group_system').id])]})
# Inherited views disable synthetic empty-state rows without modifying Odoo source.
models = ['sale.order','sale.report','account.move','account.invoice.report','stock.picking','stock.quant','product.template','product.product','purchase.order','purchase.report','mrp.production']
views = env['ir.ui.view'].search([('model','in',models),('arch_db','ilike','sample=')])
changed = []
for view in views:
    tree = etree.fromstring(view.arch_db.encode())
    if tree.tag not in ['list','graph','pivot','kanban'] or tree.get('sample') != '1':
        continue
    upsert('no_sample_'+str(view.id),'ir.ui.view',{'name':'MA2F real data only: '+view.name,'model':view.model,'inherit_id':view.id,'priority':99,'arch_base':'<xpath expr="/'+tree.tag+'" position="attributes"><attribute name="sample">0</attribute></xpath>'})
    changed.append(view)
# Replace quotation tutorials with truthful empty states; do not silently filter by owner.
for action in env['ir.actions.act_window'].search([('res_model','=','sale.order')]):
    values = {'help':'<p>Aucune commande Odoo dans cette vue.</p><p>Les ventes historiques sont dans Ventes MA2F — historique importé. La synchronisation des nouvelles commandes MA2F reste à activer.</p>'}
    if action.id in [520,521]:
        values['context'] = '{}'
    backup(action, values)
for view in changed:
    assert etree.fromstring(env[view.model].with_user(6).get_view(view_id=view.id,view_type=view.type)['arch'].encode()).get('sample') == '0'
assert {m:env[m].search_count([]) for m in business_models} == before
assert history.search_count([]) == count and history._read_group([],[],['x_total:sum'])[0][0] == total
assert not history.has_access('write') and not history.has_access('create')
result = {'mode':MODE,'sales':count,'recordedTotalFCFA':total,'historyActionId':history_action.id,'reportActionId':report.id,'sampleViewsDisabled':len(changed),'templateDashboardsUnpublished':dashboards,'businessCountsUnchanged':before,'liveOrderSyncEnabled':False}
if MODE == 'preview':
    env.cr.rollback()
else:
    env.cr.commit()
    env.registry.registry_invalidated = True
    env.registry.signal_changes()
Path(RESULT_PATH).write_text(json.dumps(result))
'''
code = code.replace('MODE', repr(sys.argv[1])).replace('RESULT_PATH', repr(str(ROOT/'.local/real-navigation-result.json')))
run_native('real-navigation', code)
