"""Executed only by the private maintenance runner inside an Odoo shell."""
import json, secrets
from datetime import datetime,timedelta
from pathlib import Path
from odoo import Command
assert env.cr.dbname=='ma2f_odoo' and env.company.id==1
assert env.company.currency_id.name=='XOF'
assert env.ref('ma2f_access.designated_admin').id==6
params=env['ir.config_parameter'].sudo()
assert params.get_param('ma2f.integration.business_enabled')=='false'
assert params.get_param('ma2f.integration.sachets_per_pack')=='30'
pack=env.ref('ma2f_integration.finished_pack')
assert pack.company_id==env.company and not pack.taxes_id and not pack.supplier_taxes_id
assert env.ref('ma2f_core.order_gate').company_id==env.company
pricelist=env.ref('ma2f_core.order_pricelist')
assert pricelist.company_id==env.company and pricelist.currency_id==env.company.currency_id
assert params.get_param('ma2f.integration.sale_pricelist_id')==str(pricelist.id)
user=env.ref('ma2f_core.order_gateway_user',raise_if_not_found=False)
key_path=Path('/tmp/ma2f-odoo-order-key.json')
before={m:env[m].search_count([]) for m in ['sale.order','account.move','account.payment','stock.move','stock.quant','mrp.production']}
if MODE=='prepare':
    assert not user and not key_path.exists() and not env['res.users'].with_context(active_test=False).search_count([('login','=','ma2f.orders')])
    assert params.get_param('ma2f.integration.orders_enabled')!='true'
    user=env['res.users'].with_context(no_reset_password=True,tracking_disable=True).create({
        'name':'MA2F — Devis uniquement','login':'ma2f.orders','password':secrets.token_urlsafe(48),
        'company_id':1,'company_ids':[Command.set([1])],
        'group_ids':[Command.set([env.ref('base.group_portal').id,env.ref('ma2f_core.group_gateway').id])]})
    env['ir.model.data'].create({'module':'ma2f_core','name':'order_gateway_user','model':'res.users','res_id':user.id,'noupdate':True})
    expiry=datetime.now()+timedelta(days=30)
    key=env['res.users.apikeys'].with_user(user)._generate('rpc','MA2F draft orders',expiry)
    key_path.write_text(json.dumps({'key':key,'userId':user.id,'expiresAt':expiry.isoformat()}))
    user.active=False
assert user and user.login=='ma2f.orders' and user.share and user.company_ids==env.company
assert user.has_group('ma2f_core.group_gateway') and not user.has_group('base.group_system')
for model in ['sale.order','account.move','account.payment','stock.move','stock.quant','mrp.production']:
    for operation in ['create','write','unlink']:assert not env[model].with_user(user).has_access(operation),(model,operation)
if MODE=='enable':
    assert key_path.exists(),'Private credential checkpoint required'
    assert json.loads(key_path.read_text())['userId']==user.id
    user.active=True
    params.set_param('ma2f.integration.orders_enabled','true')
assert before=={m:env[m].search_count([]) for m in before}
env.cr.commit()
Path(RESULT_PATH).write_text(json.dumps({'mode':MODE,'userId':user.id,'active':user.active,
    'ordersEnabled':params.get_param('ma2f.integration.orders_enabled')=='true','stockAndProductionEnabled':False,'businessRecordsUnchanged':True}))
