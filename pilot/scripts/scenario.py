"""Native stock/manufacturing acceptance test; all business changes rolled back."""
import json
from pathlib import Path

assert env.cr.dbname == "ma2f_pilot", "Only the pilot database may run this test"
assert env["ir.config_parameter"].sudo().get_param("ma2f.pilot_only") == "true"
film = env["product.product"].search([("default_code", "=", "MA2F-PILOT-FILM")], limit=1)
sachet = env["product.product"].search([("default_code", "=", "MA2F-PILOT-SACHET")], limit=1)
assert film and sachet, "Initialize the pilot first"
warehouse = env["stock.warehouse"].search([("company_id", "=", env.company.id)], limit=1)
stock = warehouse.lot_stock_id
supplier = env.ref("stock.stock_location_suppliers")
customer = env.ref("stock.stock_location_customers")
quant = env["stock.quant"]
report = Path("/run/ma2f/scenario-result.json")
report.write_text(json.dumps({"status": "running"}))

def qty(product):
    return quant._get_available_quantity(product, stock)

def move(product, amount, source, target):
    record = env["stock.move"].create({
        "product_id": product.id, "product_uom_qty": amount,
        "product_uom": product.uom_id.id, "location_id": source.id,
        "location_dest_id": target.id, "company_id": env.company.id,
    })
    record._action_confirm()
    record.quantity = amount
    record.picked = True
    record._action_done()
    return record

try:
    initial_film, initial_sachets = qty(film), qty(sachet)
    move(film, 10, supplier, stock)
    bom = env["mrp.bom"].search([("code", "=", "MA2F-PILOT-BOM")], limit=1)
    mo = env["mrp.production"].create({
        "product_id": sachet.id, "product_qty": 300, "product_uom_id": sachet.uom_id.id,
        "bom_id": bom.id, "location_src_id": stock.id, "location_dest_id": stock.id,
        "company_id": env.company.id,
    })
    mo.action_confirm()
    mo.qty_producing = 300
    for raw in mo.move_raw_ids:
        raw.quantity = raw.product_uom_qty
        raw.picked = True
    completion = mo.with_context(skip_backorder=True).button_mark_done()
    assert mo.state == "done", "Manufacturing was not validated: " + repr(completion)
    assert abs(qty(film) - initial_film - 9.5) < 0.0001, "Incorrect material consumption"
    assert abs(qty(sachet) - initial_sachets - 300) < 0.0001, "Incorrect finished goods quantity"
    move(sachet, 100, stock, customer)
    move(sachet, 10, customer, stock)
    assert abs(qty(sachet) - initial_sachets - 210) < 0.0001, "Incorrect dispatch/return quantities"
    reader = env["res.users"].search([("login", "=", "ma2f.pilot.reader")], limit=1)
    assert not env["stock.quant"].with_user(reader).has_access("write"), "Reader can write stock"
    assert not env["stock.move"].with_user(reader).has_access("create"), "Reader can create movements"
    result = {"status": "passed", "received_kg": 10, "consumed_kg": 0.5,
              "produced_sachets": 300, "dispatched_sachets": 100, "returned_sachets": 10,
              "remaining_sachets": 210, "reader_write_denied": True,
              "business_changes": "rolled_back", "scope": "stock and manufacturing only"}
except Exception:
    report.write_text(json.dumps({"status": "failed", "business_changes": "rolled_back"}))
    raise
finally:
    env.cr.rollback()

report.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
