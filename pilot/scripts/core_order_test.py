"""Fictional native order tests; never run against the live database."""
import uuid
from unittest.mock import patch
from odoo import Command
from odoo.exceptions import AccessError, UserError, ValidationError
assert env.cr.dbname == 'ma2f_core_test'
try:
    params=env['ir.config_parameter'].sudo()
    currency=env.ref('base.XOF');currency.active=True
    env.company.currency_id=currency
    params.set_param('ma2f.integration.orders_enabled','true')
    params.set_param('ma2f.integration.sachets_per_pack','30')
    pack=env['product.product'].create({'name':'Fictional pack of 30','type':'consu','is_storable':True,'uom_id':env.ref('uom.product_uom_unit').id,'company_id':1})
    # Fictional rollback-only fixture proves inherited taxes cannot leak into orders.
    inherited_tax=env['account.tax'].create({'name':'Fictional inherited tax','amount':15,'type_tax_use':'sale','company_id':1})
    pack.taxes_id=[Command.set([inherited_tax.id])]
    env['ir.model.data'].create({'module':'ma2f_integration','name':'finished_pack','model':pack._name,'res_id':pack.id})
    customer=env['res.partner'].create({'name':'Fictional order customer','company_id':1,'customer_rank':1})
    pricelist=env['product.pricelist'].create({'name':'Fictional XOF price list','company_id':1,'currency_id':currency.id})
    params.set_param('ma2f.integration.sale_pricelist_id',str(pricelist.id))
    env['ma2f.core.gate'].create({'company_id':1})
    user=env['res.users'].with_context(no_reset_password=True).create({'name':'Fictional order gateway','login':'fictional_order_gateway','company_id':1,'company_ids':[Command.set([1])],'group_ids':[Command.set([env.ref('base.group_portal').id,env.ref('ma2f_core.group_gateway').id])]})
    gateway=env['ma2f.core.operation'].with_user(user)
    for model in ['sale.order','account.move','stock.move']:
        assert not env[model].with_user(user).has_access('create')
    before={m:env[m].search_count([]) for m in ['account.move','stock.move','stock.quant']}
    command={'requestId':str(uuid.uuid4()),'actorId':'fixture_actor','customerId':customer.id,'packs':7,'unitPriceFCFA':600}
    receipt=gateway.record_order(command)
    assert receipt['totalFCFA']==4200 and receipt['state']=='draft' and not receipt['stockReserved']
    order=env['sale.order'].browse(receipt['orderId'])
    assert order.amount_total==4200 and order.amount_tax==0 and not order.order_line.tax_ids and not order.picking_ids and not order.invoice_ids
    assert gateway.record_order(command)['replayed'] is True
    assert env['sale.order'].search_count([('origin','=','MA2F '+command['requestId'])])==1
    def refused(payload,error):
        try:gateway.record_order(payload)
        except error:return
        raise AssertionError('Expected rejection')
    refused(dict(command,packs=8),UserError)
    for patch_value in [{'packs':True},{'unitPriceFCFA':0},{'companyId':1},{'requestId':'invalid'}]:
        refused(dict(command,**patch_value),ValidationError)
    refused(dict(command,requestId=str(uuid.uuid4()),taxId=1),ValidationError)
    assert gateway.record_order(command)['orderId']==receipt['orderId']
    customer.active=False
    refused(dict(command,requestId=str(uuid.uuid4())),UserError)
    customer.active=True
    count=env['sale.order'].search_count([])
    ledger=env['ma2f.core.operation'].search_count([])
    with patch.object(type(env['sale.order']),'create',side_effect=UserError('simulated failure')):
        refused(dict(command,requestId=str(uuid.uuid4())),UserError)
    assert env['sale.order'].search_count([])==count
    assert env['ma2f.core.operation'].search_count([])==ledger
    params.set_param('ma2f.integration.orders_enabled','false')
    refused(dict(command,requestId=str(uuid.uuid4())),AccessError)
    try:env['ma2f.core.operation'].with_user(env.ref('base.public_user')).record_order(command)
    except AccessError:pass
    else:raise AssertionError('Public caller accepted')
    assert {m:env[m].search_count([]) for m in before}==before
    print('CORE_ORDER_NATIVE_ROLLBACK_TESTS_PASSED')
finally:
    env.cr.rollback()
