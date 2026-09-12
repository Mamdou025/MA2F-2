"""Native Odoo archive and restore drill into a new, unexposed database."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from odoo import api, SUPERUSER_ID
from odoo.modules.registry import Registry
from odoo.service.db import dump_db, restore_db
from odoo.tools import config

assert env.cr.dbname == 'ma2f_pilot'
assert env['ir.config_parameter'].sudo().get_param('ma2f.pilot_only') == 'true'
assert env['ir.config_parameter'].sudo().get_param('ma2f.pilot_writes_enabled') == 'false'
local = Path('/run/ma2f')
report = local / 'backup-result.json'
report.write_text(json.dumps({'status': 'running'}))
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + uuid4().hex[:8]
directory = local / 'backups'
directory.mkdir(exist_ok=True)
archive = directory / ('ma2f_pilot_' + stamp + '.zip')
destination = 'ma2f_restore_' + stamp.lower()
assert destination.startswith('ma2f_restore_') and destination != env.cr.dbname
payload = b'MA2F fictional filestore restore verification\n'
attachment = env['ir.attachment'].create({'name': 'MA2F restore drill ' + stamp, 'raw': payload})
assert attachment.store_fname, 'Fixture must exercise the filestore'
models = ['product.product', 'stock.move', 'stock.quant', 'mrp.production',
          'ma2f.pilot.operation', 'account.move', 'res.users']
counts = {model: env[model].with_context(active_test=False).search_count([]) for model in models}
env.cr.commit()
original = config['list_db']
try:
    # Only this no-HTTP shell can manage databases during the maintenance window.
    config['list_db'] = True
    with archive.open('xb') as stream:
        dump_db('ma2f_pilot', stream, backup_format='zip', with_filestore=True)
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    archive.with_suffix('.sha256').write_text(digest + '  ' + archive.name + '\n')
    # Database manager stays disabled in the deployed config. This shell has no HTTP listener.
    restore_db(destination, str(archive), copy=True, neutralize_database=True)
    with Registry(destination).cursor() as cr:
        restored = api.Environment(cr, SUPERUSER_ID, {})
        assert all(restored[m].with_context(active_test=False).search_count([]) == n for m, n in counts.items())
        assert restored['ir.attachment'].browse(attachment.id).raw == payload
        assert restored['ir.config_parameter'].sudo().get_param('ma2f.pilot_writes_enabled') == 'false'
    result = {'status': 'passed', 'archive': archive.name, 'sha256': digest,
              'restore_database': destination, 'restored_counts': counts,
              'filestore_payload_verified': True, 'restored_database_neutralized': True,
              'original_database_preserved': True,
              'scope': 'local pilot recovery drill; no offsite backup or production retention'}
except Exception:
    report.write_text(json.dumps({'status': 'failed', 'archive': archive.name,
                                 'restore_database': destination}))
    raise
finally:
    config['list_db'] = original
report.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
