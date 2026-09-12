"""Create native draft orders only, without tax calculation; taxes are managed outside Odoo."""
import hashlib
import json
import re
from odoo import api, fields, models, Command
from odoo.exceptions import AccessError, UserError, ValidationError


class OrderOperation(models.Model):
    _inherit = 'ma2f.core.operation'
    order_id = fields.Many2one('sale.order', readonly=True, ondelete='restrict')

    @api.model
    def record_order(self, command):
        if not self.env.user.has_group('ma2f_core.group_gateway'):
            raise AccessError('MA2F_FORBIDDEN')
        if self.env.cr.dbname not in ['ma2f_odoo', 'ma2f_core_test'] or self.env.company.id != 1:
            raise AccessError('MA2F_WRONG_DATABASE_OR_COMPANY')
        config = self.env['ir.config_parameter'].sudo()
        if config.get_param('ma2f.integration.orders_enabled') != 'true':
            raise AccessError('MA2F_ORDERS_DISABLED')
        keys = {'requestId', 'actorId', 'customerId', 'packs', 'unitPriceFCFA'}
        if not isinstance(command, dict) or set(command) != keys:
            raise ValidationError('MA2F_INVALID_ORDER')
        request_id, actor = command['requestId'], command['actorId']
        if not isinstance(request_id, str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', request_id):
            raise ValidationError('MA2F_INVALID_REQUEST_ID')
        if not isinstance(actor, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', actor):
            raise ValidationError('MA2F_INVALID_ACTOR')
        for key, maximum in [('packs',100000), ('unitPriceFCFA',1000000), ('customerId',2147483647)]:
            if type(command[key]) is not int or not 1 <= command[key] <= maximum:
                raise ValidationError('MA2F_INVALID_ORDER')
        fingerprint = hashlib.sha256(json.dumps(command,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        # Same lock as production: duplicate requests cannot create separate orders.
        self.env.cr.execute('UPDATE ma2f_core_gate SET revision=revision+1 WHERE company_id=%s RETURNING id', [1])
        if not self.env.cr.fetchone():
            raise UserError('MA2F_NOT_CONFIGURED')
        existing = self.sudo().search([('company_id','=',1),('request_id','=',request_id)],limit=1)
        if existing:
            if existing.gateway_user_id.id != self.env.uid or existing.fingerprint != fingerprint or not existing.order_id or not existing.result:
                raise UserError('MA2F_REQUEST_CONFLICT')
            return dict(existing.result,replayed=True)
        if config.get_param('ma2f.integration.sachets_per_pack') != '30':
            raise UserError('MA2F_PACK_CONFIGURATION_REQUIRED')
        native = self.sudo().env
        customer = native['res.partner'].browse(command['customerId']).exists()
        pack = native.ref('ma2f_integration.finished_pack')
        currency = native.company.currency_id
        pricelist_key = config.get_param('ma2f.integration.sale_pricelist_id') or ''
        if not re.fullmatch(r'[1-9][0-9]{0,9}', pricelist_key):
            raise UserError('MA2F_PRICELIST_CONFIGURATION_REQUIRED')
        pricelist = native['product.pricelist'].browse(int(pricelist_key)).exists()
        if not pricelist or not pricelist.active or pricelist.company_id.id != 1 or pricelist.currency_id != currency:
            raise UserError('MA2F_PRICELIST_CONFIGURATION_REQUIRED')
        if not customer or not customer.active or customer.company_id.id != 1 or customer.type != 'contact' or customer.customer_rank < 1:
            raise UserError('MA2F_CUSTOMER_MAPPING_REQUIRED')
        if currency.name != 'XOF' or currency.rounding != 1 or pack.company_id.id != 1 or not pack.active or not pack.sale_ok or pack.uom_id != native.ref('uom.product_uom_unit'):
            raise UserError('MA2F_UNSUPPORTED_ORDER_CONFIGURATION')
        with self.env.cr.savepoint():
            operation = self.sudo().create({'request_id':request_id,'actor_id':actor,'company_id':1,'gateway_user_id':self.env.uid,'fingerprint':fingerprint})
            order = native['sale.order'].with_context(tracking_disable=True,mail_create_nolog=True,mail_create_nosubscribe=True).create({
                'partner_id':customer.id,'company_id':1,'pricelist_id':pricelist.id,'origin':'MA2F '+request_id,
                'order_line':[Command.create({'product_id':pack.id,'product_uom_qty':command['packs'],
                    'price_unit':command['unitPriceFCFA'],'discount':0,'tax_ids':[Command.clear()]})]})
            expected = command['packs'] * command['unitPriceFCFA']
            if order.state != 'draft' or order.currency_id != currency or order.amount_total != expected or order.order_line.tax_ids or order.amount_tax != 0 or order.picking_ids or order.invoice_ids:
                raise UserError('MA2F_ORDER_TOTAL_OR_STATE_MISMATCH')
            result = {'requestId':request_id,'orderId':order.id,'orderName':order.name,'state':'draft',
                'customerId':customer.id,'packs':command['packs'],'unitPriceFCFA':command['unitPriceFCFA'],
                'totalFCFA':expected,'stockReserved':False,'invoicePosted':False,'replayed':False}
            operation.write({'order_id':order.id,'result':result})
            return result
