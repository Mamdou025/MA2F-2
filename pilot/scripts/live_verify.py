"""Verify committed HTTP outcomes using native stock and operation records."""
import json
from pathlib import Path

assert env.cr.dbname == 'ma2f_pilot'
local = Path('/run/ma2f')
state = json.loads((local / 'live-fixture.json').read_text())
responses = json.loads((local / 'live-responses.json').read_text())
assert responses['http_checks_passed']
operations = env['ma2f.pilot.operation'].sudo().search([('request_id', 'in', state['request_ids'])])
assert len(operations) == 2
assert len(operations.production_id) == 2 and all(p.state == 'done' for p in operations.production_id)
stock = env.ref('ma2f_pilot_commands.fixture_stock')
quant = env['stock.quant']
kg = quant._get_available_quantity(env.ref('ma2f_pilot_commands.fixture_film'), stock)
units = quant._get_available_quantity(env.ref('ma2f_pilot_commands.fixture_sachet'), stock)
assert abs(kg - (state['initial_kg'] + 1.4 - float(responses['competing_kg']))) < 0.0001
assert abs(units - state['initial_units'] - 400) < 0.0001
assert env['ir.config_parameter'].sudo().get_param('ma2f.pilot_writes_enabled') == 'false'
result = {'status': 'passed', 'same_uuid_parallel_requests': 6,
    'same_uuid_orders_created': 1, 'competing_stock_requests': 2,
    'competing_stock_successes': 1, 'conflicting_retry_denied': True,
    'lost_response_retry_replayed': True, 'stock_verified': True,
    'writes_disabled_after_test': True, 'business_changes': 'committed fictional test records',
    'scope': 'local HTTP / gateway / Odoo JSON-2 / PostgreSQL'}
(local / 'live-result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
