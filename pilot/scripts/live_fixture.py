"""Receive fictitious stock for the HTTP concurrency test; commits pilot data."""
import json
from pathlib import Path
from uuid import uuid4

assert env.cr.dbname == 'ma2f_pilot'
params = env['ir.config_parameter'].sudo()
assert params.get_param('ma2f.pilot_only') == 'true'
assert params.get_param('ma2f.pilot_writes_enabled') == 'false'
film = env.ref('ma2f_pilot_commands.fixture_film')
sachet = env.ref('ma2f_pilot_commands.fixture_sachet')
stock = env.ref('ma2f_pilot_commands.fixture_stock')
quant = env['stock.quant']
initial_kg = quant._get_available_quantity(film, stock)
assert 0 <= initial_kg < 900
state = {'initial_kg': initial_kg, 'initial_units': quant._get_available_quantity(sachet, stock),
         'request_ids': [str(uuid4()) for _ in range(3)]}
move = env['stock.move'].create({'product_id': film.id, 'product_uom_qty': 2,
    'product_uom': film.uom_id.id, 'location_id': env.ref('stock.stock_location_suppliers').id,
    'location_dest_id': stock.id, 'origin': 'MA2F HTTP CONCURRENCY TEST'})
move._action_confirm()
move.quantity, move.picked = 2, True
move._action_done()
state['receipt_id'] = move.id
env.cr.commit()
Path('/run/ma2f/live-fixture.json').write_text(json.dumps(state))
print('Fictitious HTTP fixture received; transaction records will remain in the pilot.')
