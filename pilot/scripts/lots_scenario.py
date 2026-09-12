"""Native lot traceability, expiry and scrap drill; everything rolled back."""
import json
from pathlib import Path
from odoo import Command

assert env.cr.dbname == 'ma2f_pilot'
assert env['ir.config_parameter'].sudo().get_param('ma2f.pilot_only') == 'true'
report = Path('/run/ma2f/lots-result.json')
report.write_text(json.dumps({'status': 'running'}))
checks = []
try:
    film = env.ref('ma2f_pilot_commands.fixture_film').copy({
        'name': 'PILOTE Plastique tracé', 'default_code': 'MA2F-TEST-FILM-LOT', 'tracking': 'lot'})
    sachet = env.ref('ma2f_pilot_commands.fixture_sachet').copy({
        'name': 'PILOTE Sachet tracé', 'default_code': 'MA2F-TEST-SACHET-LOT', 'tracking': 'lot',
        'use_expiration_date': True, 'expiration_time': 90})
    stock = env.ref('ma2f_pilot_commands.fixture_stock')
    raw_lot = env['stock.lot'].create({'name': 'PILOTE-RAW-LOT', 'product_id': film.id})
    finished_lot = env['stock.lot'].create({'name': 'PILOTE-FINISHED-LOT', 'product_id': sachet.id})
    receipt = env['stock.move'].create({'product_id': film.id, 'product_uom_qty': 2,
        'product_uom': film.uom_id.id, 'location_id': env.ref('stock.stock_location_suppliers').id,
        'location_dest_id': stock.id})
    receipt._action_confirm()
    receipt.quantity = 2
    receipt.move_line_ids.lot_id = raw_lot
    receipt.picked = True
    receipt._action_done()
    assert receipt.state == 'done' and receipt.move_line_ids.lot_id == raw_lot
    checks.append('supplier material receipt assigned to a lot')
    bom = env['mrp.bom'].create({'product_tmpl_id': sachet.product_tmpl_id.id,
        'product_id': sachet.id, 'product_qty': 300, 'product_uom_id': sachet.uom_id.id,
        'type': 'normal', 'consumption': 'flexible', 'company_id': env.company.id,
        'bom_line_ids': [Command.create({'product_id': film.id, 'product_qty': 0.5,
                                         'product_uom_id': film.uom_id.id})]})
    mo = env['mrp.production'].create({'product_id': sachet.id, 'product_qty': 300,
        'product_uom_id': sachet.uom_id.id, 'bom_id': bom.id,
        'location_src_id': stock.id, 'location_dest_id': stock.id})
    mo.action_confirm()
    mo.action_assign()
    mo.qty_producing = 300
    mo.lot_producing_ids = [Command.set(finished_lot.ids)]
    for move in mo.move_raw_ids:
        move.quantity = move.product_uom_qty
        move.picked = True
    mo.with_context(skip_backorder=True).button_mark_done()
    assert mo.state == 'done'
    raw_lines = mo.move_raw_ids.move_line_ids
    finished_lines = mo.move_finished_ids.move_line_ids
    assert raw_lines.lot_id == raw_lot and finished_lines.lot_id == finished_lot
    assert raw_lines in finished_lines.consume_line_ids
    assert finished_lot.expiration_date
    checks.append('finished lot linked to consumed material lot, with expiry date')
    scrap = env['stock.scrap'].create({'product_id': sachet.id, 'scrap_qty': 10,
        'product_uom_id': sachet.uom_id.id, 'lot_id': finished_lot.id, 'location_id': stock.id})
    scrap.action_validate()
    assert scrap.state == 'done'
    assert env['stock.quant']._get_available_quantity(sachet, stock, lot_id=finished_lot) == 290
    assert abs(env['stock.quant']._get_available_quantity(film, stock, lot_id=raw_lot) - 1.5) < 0.0001
    checks.append('10 rejected finished units scrapped from their lot; 290 units available')
    result = {'status': 'passed', 'checks': checks, 'business_changes': 'rolled_back',
              'scope': 'native Odoo only; fictitious 90-day expiry and gross production semantics'}
except Exception:
    report.write_text(json.dumps({'status': 'failed', 'completed_checks': checks}))
    raise
finally:
    env.cr.rollback()
report.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
