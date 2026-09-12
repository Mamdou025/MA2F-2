"""Executed inside `odoo shell`. Idempotent seed, only in ma2f_pilot."""
import json
from datetime import datetime, timedelta
from pathlib import Path

from odoo import Command

assert env.cr.dbname == "ma2f_pilot", "Refusing any non-pilot database"
local = Path("/run/ma2f")
params = env["ir.config_parameter"].sudo()
company = env.ref("base.main_company")
company.write({"name": "MA2F — PILOTE FICTIF", "country_id": env.ref("base.sn").id,
               "currency_id": env.ref("base.XOF").id})
admin = env.ref("base.user_admin")
env["account.chart.template"].try_loading("sn", company, install_demo=False, force_create=False)
admin.write({"login": "pilote.admin", "name": "Administrateur du pilote MA2F",
             "password": (local / "admin-password").read_text().strip(), "tz": "Africa/Dakar"})
params.set_param("auth_signup.invitation_scope", "b2b")

reader = env["res.users"].with_context(active_test=False).search([("login", "=", "ma2f.pilot.reader")], limit=1)
values = {
    "name": "MA2F connecteur pilote — lecture", "login": "ma2f.pilot.reader", "active": True,
    "company_id": company.id, "company_ids": [Command.set([company.id])],
    "group_ids": [Command.set([env.ref("base.group_user").id,
                               env.ref("ma2f_pilot_access.group_pilot_reader").id])],
}
if reader:
    reader.write(values)
else:
    reader = env["res.users"].with_context(no_reset_password=True).create(values)

# API key generation may rotate on a bootstrap retry; no client uses the old key yet.
key = env["res.users.apikeys"].with_user(reader)._generate(
    "rpc", "MA2F local read pilot", datetime.now() + timedelta(days=30))

writer = env["res.users"].with_context(active_test=False).search([("login", "=", "ma2f.pilot.writer")], limit=1)
writer_values = {
    "name": "MA2F connecteur pilote — production", "login": "ma2f.pilot.writer", "active": True,
    "company_id": company.id, "company_ids": [Command.set([company.id])],
    "group_ids": [Command.set([env.ref("base.group_user").id,
                               env.ref("ma2f_pilot_commands.group_pilot_writer").id])],
}
if writer:
    writer.write(writer_values)
else:
    writer = env["res.users"].with_context(no_reset_password=True).create(writer_values)
writer_key = env["res.users.apikeys"].with_user(writer)._generate(
    "rpc", "MA2F local production pilot", datetime.now() + timedelta(days=30))

unit = env.ref("uom.product_uom_unit")
kg = env.ref("uom.product_uom_kgm")

def product(code, name, uom):
    record = env["product.product"].search([("default_code", "=", code)], limit=1)
    if not record:
        record = env["product.product"].create({
            "name": name, "default_code": code, "type": "consu", "is_storable": True,
            "uom_id": uom.id, "company_id": company.id,
            "taxes_id": [Command.clear()], "supplier_taxes_id": [Command.clear()],
        })
    return record

film = product("MA2F-PILOT-FILM", "PILOTE — plastique en kg", kg)
sachet = product("MA2F-PILOT-SACHET", "PILOTE — sachet à l'unité", unit)
if not env["mrp.bom"].search_count([("code", "=", "MA2F-PILOT-BOM")]):
    env["mrp.bom"].create({
        "code": "MA2F-PILOT-BOM", "product_tmpl_id": sachet.product_tmpl_id.id,
        "product_id": sachet.id, "product_qty": 300, "product_uom_id": unit.id,
        "company_id": company.id, "type": "normal",
        "bom_line_ids": [Command.create({"product_id": film.id, "product_qty": 0.5,
                                          "product_uom_id": kg.id})],
    })

bom = env["mrp.bom"].search([("code", "=", "MA2F-PILOT-BOM")], limit=1)
bom.consumption = "flexible"
warehouse = env["stock.warehouse"].search([("company_id", "=", company.id)], limit=1)
assert warehouse, "Missing pilot warehouse"
for name, record in {"fixture_film": film, "fixture_sachet": sachet,
                     "fixture_bom": bom, "fixture_stock": warehouse.lot_stock_id}.items():
    xmlid = env["ir.model.data"].sudo().search([
        ("module", "=", "ma2f_pilot_commands"), ("name", "=", name)], limit=1)
    values = {"module": "ma2f_pilot_commands", "name": name,
              "model": record._name, "res_id": record.id, "noupdate": True}
    if xmlid:
        xmlid.write(values)
    else:
        env["ir.model.data"].sudo().create(values)
if not env["ma2f.pilot.gate"].sudo().search_count([("company_id", "=", company.id)]):
    env["ma2f.pilot.gate"].sudo().create({"company_id": company.id})

# All ratios and prices above/below are illustrative test inputs, never MA2F settings.
params.set_param("ma2f.pilot_only", "true")
params.set_param("ma2f.pilot_company_id", str(company.id))
params.set_param("ma2f.pilot_writes_enabled", "false")
env.cr.commit()
(local / "odoo-api-key").write_text(key)
(local / "odoo-writer-key").write_text(writer_key)
(local / "production-enabled").write_text("false")
(local / "initialized.json").write_text(json.dumps({
    "database": env.cr.dbname, "company_id": company.id, "admin_login": "pilote.admin",
    "fixture": "fictional-v2", "film_id": film.id, "sachet_id": sachet.id,
}))
print("MA2F pilot seeded. One human administrator, separate read/production identities. Writes disabled.")
