"""Native Odoo acceptance checks, entirely rolled back; not a concurrency benchmark."""
import json
import sys
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from odoo.exceptions import AccessError, UserError, ValidationError

sys.path.insert(0, "/opt/ma2f")
from command_verification import code_fingerprint

assert env.cr.dbname == "ma2f_pilot"
report = Path("/run/ma2f/commands-result.json")
report.write_text(json.dumps({"status": "running"}))
checks = []

try:
    params = env["ir.config_parameter"].sudo()
    assert params.get_param("ma2f.pilot_only") == "true"
    writer = env["res.users"].search([("login", "=", "ma2f.pilot.writer")], limit=1)
    reader = env["res.users"].search([("login", "=", "ma2f.pilot.reader")], limit=1)
    assert writer and reader
    service = env["ma2f.pilot.operation"].with_user(writer)
    ledger = env["ma2f.pilot.operation"].sudo()
    film = env.ref("ma2f_pilot_commands.fixture_film")
    sachet = env.ref("ma2f_pilot_commands.fixture_sachet")
    stock = env.ref("ma2f_pilot_commands.fixture_stock")
    supplier = env.ref("stock.stock_location_suppliers")
    quant = env["stock.quant"]

    def command(**changes):
        return dict({"request_id": str(uuid4()), "produced_units": 300, "consumed_kg": "0.60"}, **changes)

    def reject(label, data, error, code, user_service=None):
        before = ledger.search_count([])
        try:
            (user_service if user_service is not None else service).record_production(data)
        except error as exc:
            assert str(exc) == code, (label, str(exc))
        else:
            raise AssertionError(label + " was accepted")
        assert ledger.search_count([]) == before
        checks.append(label)

    params.set_param("ma2f.pilot_writes_enabled", "false")
    reject("writes disabled", command(), AccessError, "MA2F_WRITES_DISABLED")
    params.set_param("ma2f.pilot_writes_enabled", "true")
    reject("reader denied", command(), AccessError, "MA2F_FORBIDDEN",
           env["ma2f.pilot.operation"].with_user(reader))
    reject("invalid quantity", command(produced_units=-1), ValidationError, "MA2F_INVALID_COMMAND")
    reject("actor spoof denied", command(actor="admin"), ValidationError, "MA2F_INVALID_COMMAND")

    initial_kg = quant._get_available_quantity(film, stock)
    initial_units = quant._get_available_quantity(sachet, stock)
    # Insufficient check exceeds stock (test fixture should be small); do not alter existing quants.
    if initial_kg < 999:
        reject("insufficient stock", command(consumed_kg="1000"), UserError, "MA2F_INSUFFICIENT_STOCK")
    else:
        raise AssertionError("Pilot stock too large for this fixture; use a clean test database")

    receipt = env["stock.move"].create({
        "product_id": film.id, "product_uom_qty": 2, "product_uom": film.uom_id.id,
        "location_id": supplier.id, "location_dest_id": stock.id, "company_id": env.company.id,
    })
    receipt._action_confirm()
    receipt.quantity, receipt.picked = 2, True
    receipt._action_done()

    first = command()
    result = service.record_production(first)
    assert result["state"] == "done" and not result["replayed"]
    assert abs(quant._get_available_quantity(film, stock) - initial_kg - 1.4) < 0.0001
    assert abs(quant._get_available_quantity(sachet, stock) - initial_units - 300) < 0.0001
    checks.append("real consumption and production quantities")
    repeated = service.record_production(dict(first, consumed_kg="0.6"))
    assert repeated["replayed"] and repeated["production_id"] == result["production_id"]
    assert abs(quant._get_available_quantity(sachet, stock) - initial_units - 300) < 0.0001
    assert ledger.search_count([("request_id", "=", first["request_id"])]) == 1
    checks.append("identical retry has no extra stock movement")
    reject("changed retry denied", dict(first, produced_units=301), UserError, "MA2F_REQUEST_CONFLICT")

    before_orders = env["mrp.production"].search_count([])
    before_kg = quant._get_available_quantity(film, stock)
    # Catch inside this transaction: the method must roll back its own partial work.
    with patch.object(type(env["mrp.production"]), "button_mark_done", side_effect=UserError("TEST_FINALIZATION_FAILURE")):
        reject("failed finalization leaves no operation", command(), UserError, "TEST_FINALIZATION_FAILURE")
    assert env["mrp.production"].search_count([]) == before_orders
    assert abs(quant._get_available_quantity(film, stock) - before_kg) < 0.0001
    checks.append("failed finalization releases reservations and removes unfinished order")
    assert not service.has_access("create") and not service.has_access("write") and not service.has_access("unlink")
    checks.append("ledger is not directly editable by integration user")
    before_kg = quant._get_available_quantity(film, stock)
    before_units = quant._get_available_quantity(sachet, stock)
    pack_command = {'request_id': str(uuid4()), 'saleable_packs': 100,
                    'rejected_sachets': 12, 'consumed_kg': '0.60'}
    packed = service.record_pack_production(pack_command)
    assert packed['saleable_sachets'] == 3000 and packed['gross_sachets'] == 3012
    assert packed['scrap_id'] and packed['produced_units'] == 3000
    assert abs(quant._get_available_quantity(sachet, stock) - before_units - 3000) < 0.0001
    assert abs(quant._get_available_quantity(film, stock) - before_kg + 0.6) < 0.0001
    scrap = env['stock.scrap'].browse(packed['scrap_id'])
    assert scrap.state == 'done' and scrap.scrap_qty == 12
    assert scrap.production_id.id == packed['production_id']
    repeat = service.record_pack_production(dict(pack_command, consumed_kg='0.6'))
    assert repeat['replayed'] and repeat['scrap_id'] == packed['scrap_id']
    checks.append('100 net packs plus 12 rejects: 3012 manufactured, 12 scrapped, 3000 saleable; retry unchanged')
    for invalid, error, code, target in [
        (dict(pack_command, rejected_sachets=13), UserError, 'MA2F_REQUEST_CONFLICT', service),
        (dict(pack_command, request_id=first['request_id'], saleable_packs=10), UserError, 'MA2F_REQUEST_CONFLICT', service),
        (dict(pack_command, actor='admin'), ValidationError, 'MA2F_INVALID_COMMAND', service),
        (pack_command, AccessError, 'MA2F_FORBIDDEN', env['ma2f.pilot.operation'].with_user(reader)),
    ]:
        try:
            target.record_pack_production(invalid)
        except error as exc:
            assert str(exc) == code
        else:
            raise AssertionError('Invalid pack request accepted')
    checks.append('pack rights, rejected count conflict, cross-contract UUID conflict and actor spoof denied')
    before_orders = env['mrp.production'].search_count([])
    before_scraps = env['stock.scrap'].search_count([])
    before_kg = quant._get_available_quantity(film, stock)
    before_units = quant._get_available_quantity(sachet, stock)
    failed_id = str(uuid4())
    with patch.object(type(env['stock.scrap']), 'action_validate', side_effect=UserError('TEST_SCRAP_FAILURE')):
        try:
            service.record_pack_production(dict(pack_command, request_id=failed_id))
        except UserError as exc:
            assert str(exc) == 'TEST_SCRAP_FAILURE'
        else:
            raise AssertionError('Expected scrap failure')
    assert env['mrp.production'].search_count([]) == before_orders
    assert env['stock.scrap'].search_count([]) == before_scraps
    assert not ledger.search_count([('request_id', '=', failed_id)])
    assert abs(quant._get_available_quantity(film, stock) - before_kg) < 0.0001
    assert abs(quant._get_available_quantity(sachet, stock) - before_units) < 0.0001
    checks.append('scrap failure rolls back the already finished MO, consumption, stock and request ledger')
    pending = env['stock.move'].create({'product_id': sachet.id, 'product_uom_qty': 45,
        'product_uom': sachet.uom_id.id, 'location_id': stock.id,
        'location_dest_id': env.ref('stock.stock_location_customers').id})
    pending._action_confirm()
    pending._action_assign()
    summary = env['ma2f.pilot.operation'].with_user(reader).get_pack_stock()
    assert abs(summary['sachets']['available'] - quant._get_available_quantity(sachet, stock)) < 0.0001
    assert summary['sachets']['reserved'] >= 45
    assert summary['available_whole_packs'] * 30 + summary['available_loose_sachets'] == summary['sachets']['available']
    assert abs(summary['film_kg']['available'] - before_kg) < 0.0001
    checks.append('reader stock summary respects reservations, full packs and loose sachets')
    result_report = {"status": "passed", "checks": checks, "code_sha256": code_fingerprint(),
                     "business_changes": "rolled_back", "concurrency_tested": False}
except Exception:
    report.write_text(json.dumps({"status": "failed", "completed_checks": checks}))
    raise
finally:
    env.cr.rollback()

report.write_text(json.dumps(result_report, indent=2))
print(json.dumps(result_report))
