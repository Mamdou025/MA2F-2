"""Native fictitious purchase-to-cash acceptance; rollback every business record."""
import json
from pathlib import Path

from odoo import Command, fields

assert env.cr.dbname == "ma2f_pilot"
assert env["ir.config_parameter"].sudo().get_param("ma2f.pilot_only") == "true"
report = Path('/run/ma2f/business-result.json')
report.write_text(json.dumps({'status': 'running'}))
checks = []

def done(picking):
    picking.action_assign()
    for move in picking.move_ids:
        move.quantity = move.product_uom_qty
        move.picked = True
    picking.with_context(skip_backorder=True).button_validate()
    assert picking.state == 'done', 'Picking requires an unresolved wizard'

try:
    company = env.company
    film = env.ref('ma2f_pilot_commands.fixture_film')
    sachet = env.ref('ma2f_pilot_commands.fixture_sachet')
    stock = env.ref('ma2f_pilot_commands.fixture_stock')
    warehouse = env['stock.warehouse'].search([('company_id', '=', company.id)], limit=1)
    quant = env['stock.quant']
    initial_kg = quant._get_available_quantity(film, stock)
    initial_units = quant._get_available_quantity(sachet, stock)
    supplier = env['res.partner'].create({'name': 'PILOTE Fournisseur plastique', 'supplier_rank': 1})
    customer = env['res.partner'].create({'name': 'PILOTE Client sachets', 'customer_rank': 1})
    purchase = env['purchase.order'].create({
        'partner_id': supplier.id,
        'order_line': [Command.create({'product_id': film.id, 'product_qty': 2,
                                       'price_unit': 1000, 'tax_ids': [Command.clear()]})],
    })
    purchase.button_confirm()
    done(purchase.picking_ids)
    assert abs(quant._get_available_quantity(film, stock) - initial_kg - 2) < 0.0001
    checks.append('purchase order and supplier receipt: 2 kg')
    purchase.action_create_invoice()
    bill = purchase.invoice_ids
    bill.invoice_date = fields.Date.today()
    bill.action_post()
    assert bill.state == 'posted' and bill.amount_total == 2000
    checks.append('supplier bill posted: 2000 XOF, fictitious tax-free price')

    mo = env['mrp.production'].create({
        'product_id': sachet.id, 'product_qty': 300, 'product_uom_id': sachet.uom_id.id,
        'bom_id': env.ref('ma2f_pilot_commands.fixture_bom').id,
        'location_src_id': stock.id, 'location_dest_id': stock.id,
    })
    mo.action_confirm()
    mo.qty_producing = 300
    for move in mo.move_raw_ids:
        move.quantity = move.product_uom_qty
        move.picked = True
    mo.with_context(skip_backorder=True).button_mark_done()
    assert mo.state == 'done'
    assert abs(quant._get_available_quantity(film, stock) - initial_kg - 1.5) < 0.0001
    checks.append('manufacturing: 300 units, 0.5 kg consumed')

    truck = env['stock.location'].create({'name': 'PILOTE Camion', 'usage': 'internal',
                                          'location_id': warehouse.view_location_id.id,
                                          'company_id': company.id})
    def transfer(amount, source, destination):
        picking = env['stock.picking'].create({
            'picking_type_id': warehouse.int_type_id.id,
            'location_id': source.id, 'location_dest_id': destination.id,
            'move_ids': [Command.create({'product_id': sachet.id, 'product_uom_qty': amount,
                'product_uom': sachet.uom_id.id, 'location_id': source.id,
                'location_dest_id': destination.id})],
        })
        picking.action_confirm()
        done(picking)
        return picking

    transfer(120, stock, truck)
    assert quant._get_available_quantity(sachet, truck) == 120
    checks.append('truck loading: internal transfer of 120 units')
    sachet.invoice_policy = 'delivery'
    sale = env['sale.order'].create({'partner_id': customer.id,
        'order_line': [Command.create({'product_id': sachet.id, 'product_uom_qty': 100,
                                       'price_unit': 10, 'tax_ids': [Command.clear()]})]})
    sale.action_confirm()
    delivery = sale.picking_ids
    delivery.do_unreserve()
    delivery.location_id = truck
    delivery.move_ids.location_id = truck
    done(delivery)
    assert quant._get_available_quantity(sachet, truck) == 20
    assert sale.order_line.qty_delivered == 100
    invoice = sale._create_invoices()
    invoice.action_post()
    assert invoice.amount_total == 1000 and invoice.amount_residual == 1000
    checks.append('sale, delivery from truck, customer invoice: 100 units / 1000 XOF')

    cash = env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'cash')], limit=1)
    if not cash:
        cash = env['account.journal'].create({'name': 'PILOTE Caisse', 'code': 'PILCA', 'type': 'cash'})
    # Explicit fictitious cash method: use cash account so the payment posts an entry.
    method = cash.inbound_payment_method_line_ids[:1]
    assert method and cash.default_account_id
    method.payment_account_id = cash.default_account_id
    payment = env['account.payment.register'].with_context(
        active_model='account.move', active_ids=invoice.ids).create({
            'journal_id': cash.id, 'payment_method_line_id': method.id, 'amount': 600,
        })._create_payments()
    assert invoice.amount_residual == 400 and payment.move_id.state == 'posted'
    checks.append('partial cash receipt posted and reconciled: 600 XOF, residual 400')

    transfer(20, truck, stock)
    assert quant._get_available_quantity(sachet, truck) == 0
    checks.append('unsold truck stock returned: 20 units')
    wizard = env['stock.return.picking'].with_context(
        active_model='stock.picking', active_id=delivery.id, active_ids=delivery.ids).create({})
    wizard.product_return_moves.quantity = 10
    returned = wizard._create_return()
    done(returned)
    # The warehouse return operation type routes customer returns to warehouse stock.
    assert returned.location_dest_id == stock
    assert quant._get_available_quantity(sachet, truck) == 0
    assert abs(quant._get_available_quantity(sachet, stock) - initial_units - 210) < 0.0001
    assert invoice.amount_residual == 400, 'Physical return must not silently modify the invoice'
    checks.append('customer return: 10 units, original invoice unchanged pending credit note')
    credit = invoice._reverse_moves(default_values_list=[{'invoice_date': fields.Date.today()}])
    credit.invoice_line_ids.filtered(lambda line: line.product_id == sachet).quantity = 10
    credit.action_post()
    assert credit.amount_total == 100 and credit.move_type == 'out_refund'
    (invoice.line_ids | credit.line_ids).filtered(
        lambda line: line.account_id.account_type == 'asset_receivable' and not line.reconciled).reconcile()
    assert invoice.amount_residual == 300 and credit.amount_residual == 0
    checks.append('explicit 100 XOF credit note reconciled: residual now 300')
    env['account.payment.register'].with_context(active_model='account.move', active_ids=invoice.ids).create({
        'journal_id': cash.id, 'payment_method_line_id': method.id, 'amount': 300,
    })._create_payments()
    assert invoice.amount_residual == 0 and invoice.payment_state == 'paid'
    checks.append('remaining 300 XOF received: customer invoice paid')
    result = {'status': 'passed', 'checks': checks, 'business_changes': 'rolled_back',
              'scope': 'native standard Odoo; no MA2F HTTP business routes or real tax configuration',
              'remaining_units': 210, 'remaining_film_kg': 1.5,
              'invoice_xof': 1000, 'credit_note_xof': 100, 'paid_xof': 900, 'residual_xof': 0}
except Exception:
    report.write_text(json.dumps({'status': 'failed', 'completed_checks': checks}))
    raise
finally:
    env.cr.rollback()
report.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
