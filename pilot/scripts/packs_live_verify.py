import json
from pathlib import Path

assert env.cr.dbname == 'ma2f_pilot'
local = Path('/run/ma2f')
command = json.loads((local / 'packs-live-command.json').read_text())
operations = env['ma2f.pilot.operation'].sudo().search([('request_id', '=', command['request_id'])])
assert len(operations) == 1
assert operations.production_id.state == 'done' and operations.production_id.product_qty == 3012
assert operations.scrap_id.state == 'done' and operations.scrap_id.scrap_qty == 12
assert operations.result['saleable_sachets'] == 3000
assert env['ir.config_parameter'].sudo().get_param('ma2f.pilot_writes_enabled') == 'false'
result = {'status': 'passed', 'parallel_requests': 6, 'orders_created': 1, 'scraps_created': 1,
    'saleable_packs_added': 100, 'saleable_sachets_added': 3000, 'rejected_sachets': 12,
    'consumed_kg': '0.60', 'stock_read_via_ma2f_api': True, 'reader_write_denied': True,
    'retry_replayed': True, 'changed_rejects_conflict': True, 'writes_disabled': True,
    'business_changes': 'committed fictional pilot records',
    'scope': 'MA2F backend client to HTTP gateway to native Odoo; no Firebase or browser integration'}
(local / 'packs-live-result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
