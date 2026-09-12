"""Native rollback tests for MA2F production. Fictional data in ma2f_core_test only."""
import uuid
from unittest.mock import patch
from odoo import Command
from odoo.exceptions import AccessError,UserError,ValidationError
assert env.cr.dbname=='ma2f_core_test'
try:
    company=env.company
    assert company.id==1
    params=env['ir.config_parameter'].sudo()
    for k,v in {'business_enabled':'true','sachets_per_pack':'30','source_sha256':'a'*64,'saleable_packs_per_kg_estimate':'17'}.items():params.set_param('ma2f.integration.'+k,v)
    kg=env.ref('uom.product_uom_kgm');unit=env.ref('uom.product_uom_unit')
    film=env['product.product'].create({'name':'Fictional test film','type':'consu','is_storable':True,'uom_id':kg.id,'company_id':1,'tracking':'none'})
    pack=env['product.product'].create({'name':'Fictional test pack of 30','type':'consu','is_storable':True,'uom_id':unit.id,'company_id':1,'tracking':'none'})
    warehouse=env['stock.warehouse'].search([('company_id','=',1)],limit=1)
    raw=env['stock.location'].create({'name':'Test materials','usage':'internal','location_id':warehouse.lot_stock_id.id,'company_id':1})
    finished=env['stock.location'].create({'name':'Test finished','usage':'internal','location_id':warehouse.lot_stock_id.id,'company_id':1})
    bom=env['mrp.bom'].create({'product_tmpl_id':pack.product_tmpl_id.id,'product_id':pack.id,'product_qty':17,'product_uom_id':unit.id,'type':'normal','consumption':'flexible','company_id':1,'bom_line_ids':[Command.create({'product_id':film.id,'product_qty':1,'product_uom_id':kg.id})]})
    for name,record in {'film':film,'finished_pack':pack,'raw_material_location':raw,'finished_location':finished,'pack_bom':bom}.items():env['ir.model.data'].create({'module':'ma2f_integration','name':name,'model':record._name,'res_id':record.id,'noupdate':True})
    env['ma2f.core.gate'].create({'company_id':1})
    user=env['res.users'].with_context(no_reset_password=True,tracking_disable=True).create({'name':'Fictional gateway','login':'ma2f_core_test_gateway','company_id':1,'company_ids':[Command.set([1])],'group_ids':[Command.set([env.ref('base.group_portal').id,env.ref('ma2f_core.group_gateway').id])]})
    assert not user.has_group('base.group_user') and not user.has_group('base.group_system')
    for model in ['stock.quant','stock.move.line','mrp.production']:
        assert not env[model].with_user(user).has_access('create')
    env['stock.quant']._update_available_quantity(film,raw,10)
    gateway=env['ma2f.core.operation'].with_user(user)
    command={'requestId':str(uuid.uuid4()),'actorId':'native_fixture_user','saleablePacks':17,'sourceSha256':'a'*64,'packsPerKg':'17'}
    result=gateway.record_production(command)
    assert result['saleablePacks']==17 and result['consumptionBasis']=='source_estimate'
    assert env['stock.quant']._get_available_quantity(film,raw)==9
    assert env['stock.quant']._get_available_quantity(pack,finished)==17
    assert gateway.record_production(command)['replayed'] is True
    assert env['mrp.production'].search_count([('product_id','=',pack.id)])==1
    def refused(payload,error):
        try:gateway.record_production(payload)
        except error:return
        raise AssertionError('Expected rejection')
    refused(dict(command,saleablePacks=34),UserError)
    refused(dict(command,requestId=str(uuid.uuid4()),saleablePacks=1700),UserError)
    refused(dict(command,requestId=str(uuid.uuid4()),sourceSha256='b'*64),UserError)
    refused(dict(command,requestId=str(uuid.uuid4()),company_id=1),ValidationError)
    refused(dict(command,requestId=str(uuid.uuid4()),saleablePacks=True),ValidationError)
    params.set_param('ma2f.integration.business_enabled','false')
    refused(dict(command,requestId=str(uuid.uuid4())),AccessError)
    params.set_param('ma2f.integration.business_enabled','true')
    try:env['ma2f.core.operation'].with_user(env.ref('base.public_user')).record_production(command)
    except AccessError:pass
    else:raise AssertionError('Unauthenticated caller accepted')
    with patch.object(type(env['mrp.production']),'button_mark_done',side_effect=UserError('simulated native validation failure')):
        refused(dict(command,requestId=str(uuid.uuid4())),UserError)
    assert env['mrp.production'].search_count([('product_id','=',pack.id)])==1
    assert env['ma2f.core.operation'].search_count([])==1
    assert env['stock.quant']._get_available_quantity(film,raw)==9
    assert env['stock.quant']._get_available_quantity(pack,finished)==17
    print('CORE_PRODUCTION_NATIVE_ROLLBACK_TESTS_PASSED')
finally:
    env.cr.rollback()
