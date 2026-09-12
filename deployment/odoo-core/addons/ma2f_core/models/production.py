"""Bounded native production command. Generic stock/MRP write rights remain absent."""
import hashlib
import json
import re
from odoo import api,fields,models
from odoo.exceptions import AccessError,UserError,ValidationError
from odoo.tools.float_utils import float_compare

class Gate(models.Model):
    _name='ma2f.core.gate'
    _description='MA2F operation serialization'
    company_id=fields.Many2one('res.company',required=True,ondelete='restrict')
    revision=fields.Integer(default=0,required=True)
    _unique_company=models.Constraint('UNIQUE(company_id)','One MA2F gate per company')

class Operation(models.Model):
    _name='ma2f.core.operation'
    _description='MA2F validated operation receipt'
    _rec_name='request_id'
    request_id=fields.Char(required=True,index=True,readonly=True)
    actor_id=fields.Char(required=True,readonly=True)
    company_id=fields.Many2one('res.company',required=True,ondelete='restrict',readonly=True)
    gateway_user_id=fields.Many2one('res.users',required=True,ondelete='restrict',readonly=True)
    fingerprint=fields.Char(required=True,readonly=True)
    production_id=fields.Many2one('mrp.production',ondelete='restrict',readonly=True)
    result=fields.Json(readonly=True)
    _unique_request=models.Constraint('UNIQUE(company_id,request_id)','MA2F_REQUEST_CONFLICT')

    @api.model
    def record_production(self,command):
        if not self.env.user.has_group('ma2f_core.group_gateway'):
            raise AccessError('MA2F_FORBIDDEN')
        config=self.env['ir.config_parameter'].sudo()
        if self.env.cr.dbname not in ['ma2f_odoo','ma2f_core_test'] or self.env.company.id!=1:
            raise AccessError('MA2F_WRONG_DATABASE_OR_COMPANY')
        if config.get_param('ma2f.integration.sachets_per_pack')!='30':
            raise UserError('MA2F_PACK_CONFIGURATION_REQUIRED')
        if config.get_param('ma2f.integration.business_enabled')!='true':
            raise AccessError('MA2F_WRITES_DISABLED')
        if not isinstance(command,dict) or set(command)!={'requestId','actorId','saleablePacks','sourceSha256','packsPerKg'}:
            raise ValidationError('MA2F_INVALID_COMMAND')
        request_id=command['requestId'];actor=command['actorId'];packs=command['saleablePacks']
        if not isinstance(request_id,str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',request_id):
            raise ValidationError('MA2F_INVALID_REQUEST_ID')
        if not isinstance(actor,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',actor) or type(packs) is not int or not 1<=packs<=100000:
            raise ValidationError('MA2F_INVALID_COMMAND')
        fingerprint=hashlib.sha256(json.dumps(command,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.env.cr.execute('UPDATE ma2f_core_gate SET revision=revision+1 WHERE company_id=%s RETURNING id',[1])
        if not self.env.cr.fetchone():raise UserError('MA2F_NOT_CONFIGURED')
        existing=self.sudo().search([('company_id','=',1),('request_id','=',request_id)],limit=1)
        if existing:
            if existing.gateway_user_id.id!=self.env.uid or existing.fingerprint!=fingerprint:raise UserError('MA2F_REQUEST_CONFLICT')
            if not existing.result:raise UserError('MA2F_INCOMPLETE_OPERATION')
            return dict(existing.result,replayed=True)
        source_sha=config.get_param('ma2f.integration.source_sha256') or ''
        if not re.fullmatch(r'[a-f0-9]{64}',source_sha):raise UserError('MA2F_SOURCE_NOT_CONFIGURED')
        rate=config.get_param('ma2f.integration.saleable_packs_per_kg_estimate') or ''
        if not re.fullmatch(r'[1-9][0-9]{0,5}',rate):raise UserError('MA2F_RATE_NOT_CONFIGURED')
        if command['sourceSha256']!=source_sha or command['packsPerKg']!=rate:raise UserError('MA2F_PRODUCTION_SETTINGS_CHANGED')
        rate=int(rate);kg=packs/rate
        native=self.sudo().env
        film=native.ref('ma2f_integration.film');pack=native.ref('ma2f_integration.finished_pack')
        raw_location=native.ref('ma2f_integration.raw_material_location');finished=native.ref('ma2f_integration.finished_location')
        bom=native.ref('ma2f_integration.pack_bom')
        if any(r.company_id.id!=1 for r in [film,pack,raw_location,finished,bom]) or film.tracking!='none' or pack.tracking!='none' or bom.type!='normal' or bom.consumption!='flexible' or bom.product_id!=pack or len(bom.bom_line_ids)!=1 or bom.bom_line_ids.product_id!=film or bom.operation_ids or bom.byproduct_ids or raw_location.usage!='internal' or finished.usage!='internal' or film.uom_id!=native.ref('uom.product_uom_kgm') or pack.uom_id!=native.ref('uom.product_uom_unit') or bom.product_qty!=rate or bom.bom_line_ids.product_qty!=1 or bom.product_uom_id!=pack.uom_id or bom.bom_line_ids.product_uom_id!=film.uom_id:
            raise UserError('MA2F_UNSUPPORTED_CONFIGURATION')
        available=native['stock.quant']._get_available_quantity(film,raw_location)
        if float_compare(available,kg,precision_rounding=film.uom_id.rounding)<0:raise UserError('MA2F_INSUFFICIENT_STOCK')
        with self.env.cr.savepoint():
            operation=self.sudo().create({'request_id':request_id,'actor_id':actor,'company_id':1,'gateway_user_id':self.env.uid,'fingerprint':fingerprint})
            production=native['mrp.production'].create({'product_id':pack.id,'product_qty':packs,'product_uom_id':pack.uom_id.id,'bom_id':bom.id,'location_src_id':raw_location.id,'location_dest_id':finished.id,'company_id':1,'origin':'MA2F '+request_id})
            production.action_confirm();raw=production.move_raw_ids
            if len(raw)!=1 or raw.product_id!=film:raise UserError('MA2F_UNSUPPORTED_CONFIGURATION')
            raw._do_unreserve();raw.product_uom_qty=kg;raw._action_assign()
            if raw.state!='assigned':raise UserError('MA2F_INSUFFICIENT_STOCK')
            production.qty_producing=packs;raw.quantity=kg;raw.picked=True
            production.with_context(skip_backorder=True).button_mark_done()
            if production.state!='done':raise UserError('MA2F_VALIDATION_REQUIRED')
            result={'requestId':request_id,'productionId':production.id,'productionName':production.name,'saleablePacks':packs,'sachetsPerPack':30,'consumptionBasis':'source_estimate','estimatedKgNumerator':packs,'estimatedKgDenominator':rate,'appliedKg':raw.quantity,'sourceSha256':source_sha,'replayed':False}
            operation.write({'production_id':production.id,'result':result})
            return result
