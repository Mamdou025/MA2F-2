"""Fictional native workflows, rolled back in a dedicated Community database."""
import json
import io
import zipfile
from pathlib import Path
from odoo import Command, fields
from odoo.exceptions import UserError, ValidationError

assert env.cr.dbname == 'ma2f_community_test'
checks = []
report = Path('/run/ma2f/community-result.json')
report.write_text(json.dumps({'status': 'running'}))

def check(name, condition):
    assert condition, name
    checks.append(name)
    print('COMMUNITY_PASS ' + name)

def complete(picking):
    picking.action_assign()
    for move in picking.move_ids:
        move.quantity = move.product_uom_qty
        move.picked = True
    picking.with_context(skip_backorder=True).button_validate()
    assert picking.state == 'done'

try:
    installed = env['ir.module.module'].search([('name', 'in', [
        'stock_no_negative', 'auditlog', 'account_financial_report', 'quality_control_oca',
        'date_range', 'report_xlsx', 'stock_fleet', 'maintenance', 'hr_expense',
    ]), ('state', '=', 'installed')])
    check('all nine selected and dependency modules installed', len(installed) == 9)
    company = env.company
    company.country_id = env.ref('base.sn')
    company.currency_id = env.ref('base.XOF')
    warehouse = env['stock.warehouse'].search([('company_id', '=', company.id)], limit=1)
    location = warehouse.lot_stock_id
    kg = env.ref('uom.product_uom_kgm')
    unit = env.ref('uom.product_uom_unit')
    film = env['product.product'].create({'name': 'COMMUNITY TEST film', 'is_storable': True,
        'type': 'consu', 'uom_id': kg.id, 'company_id': company.id})
    pack = env['product.product'].create({'name': 'COMMUNITY TEST saleable pack (30 sachets)',
        'is_storable': True, 'type': 'consu', 'uom_id': unit.id, 'company_id': company.id})
    supplier = env['res.partner'].create({'name': 'COMMUNITY TEST supplier', 'supplier_rank': 1})
    customer = env['res.partner'].create({'name': 'COMMUNITY TEST customer', 'customer_rank': 1})
    purchase = env['purchase.order'].create({'partner_id': supplier.id,
        'order_line': [Command.create({'product_id': film.id, 'product_qty': 10,
            'price_unit': 1000, 'tax_ids': [Command.clear()]})]})
    purchase.button_confirm()
    complete(purchase.picking_ids)
    quant = env['stock.quant']
    check('supplier receipt adds exactly 10 kg', quant._get_available_quantity(film, location) == 10)
    # Fixture yield only: not a statement about the real MA2F recipe.
    bom = env['mrp.bom'].create({'product_tmpl_id': pack.product_tmpl_id.id,
        'product_qty': 100, 'product_uom_id': unit.id,
        'bom_line_ids': [Command.create({'product_id': film.id, 'product_qty': 5,
            'product_uom_id': kg.id})]})
    mo = env['mrp.production'].create({'product_id': pack.id, 'product_qty': 100,
        'product_uom_id': unit.id, 'bom_id': bom.id,
        'location_src_id': location.id, 'location_dest_id': location.id})
    mo.action_confirm()
    mo.qty_producing = 100
    for move in mo.move_raw_ids:
        move.quantity = move.product_uom_qty
        move.picked = True
    mo.with_context(skip_backorder=True).button_mark_done()
    check('manufacturing produces 100 net packs, consumes 5 kg', mo.state == 'done'
        and quant._get_available_quantity(pack, location) == 100
        and quant._get_available_quantity(film, location) == 5)
    sale = env['sale.order'].create({'partner_id': customer.id,
        'order_line': [Command.create({'product_id': pack.id, 'product_uom_qty': 20,
            'price_unit': 600, 'tax_ids': [Command.clear()]})]})
    sale.action_confirm()
    sale.picking_ids.action_assign()
    check('native order reservation reduces availability to 80',
        quant._get_available_quantity(pack, location) == 80)
    first_delivery = sale.picking_ids
    first_delivery.move_ids.quantity = 12
    first_delivery.move_ids.picked = True
    first_delivery.with_context(skip_backorder=True, cancel_backorder=False).button_validate()
    backorder = sale.picking_ids.filtered(lambda record: record.state not in ['done', 'cancel'])
    check('partial delivery leaves native backorder of 8 packs',
        first_delivery.state == 'done' and sale.order_line.qty_delivered == 12
        and len(backorder) == 1 and backorder.move_ids.product_uom_qty == 8)
    complete(backorder)
    check('delivery records 20 delivered packs', sale.order_line.qty_delivered == 20)
    returns = env['stock.return.picking'].with_context(active_model='stock.picking',
        active_id=first_delivery.id, active_ids=first_delivery.ids).create({})
    returns.product_return_moves.quantity = 2
    complete(returns._create_return())
    check('customer return restores 2 packs', quant._get_available_quantity(pack, location) == 82)
    rejected = False
    try:
        with env.cr.savepoint():
            quant._update_available_quantity(pack, location, -83)
            env.flush_all()
    except (UserError, ValidationError):
        rejected = True
    check('OCA rejects negative stock and rolls back quantity', rejected
        and quant._get_available_quantity(pack, location) == 82)

    # Test explicit quality outcomes; the generic addon does not wire receipts.
    specification = env['qc.test'].create({'name': 'COMMUNITY TEST measurement',
        'category': env.ref('quality_control_oca.qc_test_template_category_generic').id})
    env['qc.test.question'].create({'name': 'Fixture measurement', 'test': specification.id,
        'type': 'quantitative', 'min_value': 1, 'max_value': 3, 'uom_id': unit.id})
    for value, expected in [(2, 'success'), (4, 'failed')]:
        inspection = env['qc.inspection'].create({'name': 'COMMUNITY TEST inspection',
            'test': specification.id,
            'inspection_lines': env['qc.inspection']._prepare_inspection_lines(specification)})
        inspection.action_todo()
        inspection.inspection_lines.quantitative_value = value
        inspection.action_confirm()
        inspection.action_approve()
        check('quality outcome ' + expected, inspection.state == expected)

    model = env['ir.model']._get('res.partner')
    rule = env['auditlog.rule'].create({'name': 'COMMUNITY TEST customer changes',
        'model_id': model.id, 'log_type': 'full', 'log_write': True, 'log_read': False})
    rule.set_to_confirmed()
    customer.name = 'COMMUNITY TEST renamed customer'
    log = env['auditlog.log'].search([('model_id', '=', model.id),
        ('res_id', '=', customer.id), ('method', '=', 'write')])
    check('OCA audit captures customer update and user', bool(log) and log[-1].user_id == env.user)
    rule.set_to_draft()
    check('financial report wizard registered', 'general.ledger.report.wizard' in env)
    debit = env['account.account'].create({'name': 'COMMUNITY TEST asset',
        'code': '999810', 'account_type': 'asset_current'})
    credit = env['account.account'].create({'name': 'COMMUNITY TEST equity',
        'code': '999820', 'account_type': 'equity'})
    journal = env['account.journal'].create({'name': 'COMMUNITY TEST journal',
        'code': 'CTEST', 'type': 'general'})
    entry = env['account.move'].create({'journal_id': journal.id, 'date': fields.Date.today(),
        'line_ids': [Command.create({'account_id': debit.id, 'debit': 12345}),
            Command.create({'account_id': credit.id, 'credit': 12345})]})
    entry.action_post()
    wizard = env['general.ledger.report.wizard'].create({'date_from': fields.Date.today(),
        'date_to': fields.Date.today(), 'company_id': company.id, 'grouped_by': 'none',
        'account_ids': [Command.set([debit.id, credit.id])]})
    data = wizard._prepare_report_data()
    rendered = env['report.account_financial_report.general_ledger']._get_report_values(wizard, data)
    balances = {row['id']: row['fin_bal']['balance'] for row in rendered['general_ledger']}
    check('OCA ledger matches balanced fictional entry exactly',
        balances.get(debit.id) == 12345 and balances.get(credit.id) == -12345)
    xlsx_action = env['ir.actions.report'].search([
        ('report_name', '=', 'a_f_r.report_general_ledger_xlsx')], limit=1)
    workbook, kind = env['ir.actions.report']._render_xlsx(xlsx_action.id, wizard.ids, data)
    with zipfile.ZipFile(io.BytesIO(workbook)) as archive:
        sheet = archive.read('xl/worksheets/sheet1.xml').decode()
    check('OCA generates actual XLSX with fixture amounts', kind == 'xlsx' and '12345' in sheet)
    check('native fleet dispatch model available', 'vehicle_id' in env['stock.picking.batch']._fields)
    check('native maintenance and expenses available',
        'maintenance.request' in env and 'hr.expense' in env)
    check('no test invoices posted', env['account.move'].search_count([
        ('state', '=', 'posted'), ('move_type', '!=', 'entry')]) == 0)
    report.write_text(json.dumps({'status': 'passed', 'checks': checks,
        'business_changes': 'rolled_back', 'scope': 'local native/OCA pilot; no live tax decision'}, indent=2))
except Exception:
    report.write_text(json.dumps({'status': 'failed', 'completed_checks': checks}, indent=2))
    raise
finally:
    env.cr.rollback()
