from pathlib import Path

assert env.cr.dbname == "ma2f_pilot"
Path("/run/ma2f/production-enabled").write_text("false")
env["ir.config_parameter"].sudo().set_param("ma2f.pilot_writes_enabled", "false")
env.cr.commit()
print("Pilot production disabled in gateway and Odoo.")
