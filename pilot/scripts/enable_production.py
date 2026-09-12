import json
import sys
from pathlib import Path

sys.path.insert(0, "/opt/ma2f")
from command_verification import code_fingerprint

assert env.cr.dbname == "ma2f_pilot"
assert env["ir.config_parameter"].sudo().get_param("ma2f.pilot_only") == "true"
report = json.loads(Path("/run/ma2f/commands-result.json").read_text())
assert report.get("status") == "passed", "Native command tests must pass first"
assert report.get("code_sha256") == code_fingerprint(), "Command code changed; rerun native tests"
env["ir.config_parameter"].sudo().set_param("ma2f.pilot_writes_enabled", "true")
env.cr.commit()
Path("/run/ma2f/production-enabled").write_text("true")
print("Local pilot production enabled. Only fictional fixture; no real MA2F identity integration.")
