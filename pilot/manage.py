"""Reproducible local pilot lifecycle. Python 3.11+ and Docker Compose required."""

import argparse
import json
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / ".local"
MODULES = "ma2f_pilot_commands,product_expiry,mrp_product_expiry,mrp_account,l10n_sn,auth_totp"


def compose(*args, timeout=900):
    subprocess.run(["docker", "compose", "-f", str(ROOT / "compose.yaml"), *args],
                   cwd=ROOT, check=True, timeout=timeout)


def prepare():
    LOCAL.mkdir(exist_ok=True)
    for name in ["db-password", "admin-password", "master-password", "gateway-token", "gateway-writer-token"]:
        path = LOCAL / name
        if not path.exists():
            path.write_text(secrets.token_urlsafe(36), encoding="utf-8")
    # Placeholder is a file (never let Docker create a directory for a missing mount).
    (LOCAL / "odoo-api-key").touch(exist_ok=True)
    (LOCAL / "odoo-writer-key").touch(exist_ok=True)
    if not (LOCAL / "production-enabled").exists():
        (LOCAL / "production-enabled").write_text("false", encoding="utf-8")
    config = LOCAL / "odoo.conf"
    if not config.exists():
        config.write_text("\n".join([
            "[options]", "db_host = db", "db_port = 5432", "db_user = odoo",
            "db_password = " + (LOCAL / "db-password").read_text(),
            "admin_passwd = " + (LOCAL / "master-password").read_text(),
            "db_name = ma2f_pilot", "dbfilter = ^ma2f_pilot$", "list_db = False",
            "data_dir = /var/lib/odoo", "addons_path = /mnt/extra-addons",
            "http_port = 8069", "proxy_mode = False", "max_cron_threads = 0",
            "workers = 0", "limit_time_real = 120", "log_level = warn", "",
        ]), encoding="utf-8")
    # Only a local credential file; never print passwords to command output.
    (LOCAL / "ACCESS.txt").write_text(
        "MA2F PILOTE LOCAL — données fictives uniquement\n"
        "URL : http://127.0.0.1:18069/odoo\n"
        "Utilisateur humain : pilote.admin\n"
        "Mot de passe : " + (LOCAL / "admin-password").read_text() + "\n"
        "Passerelle : http://127.0.0.1:18080 (jeton local dans gateway-token)\n"
        "Ne pas publier ces fichiers. Ce compte ne désigne pas l'administrateur de production.\n",
        encoding="utf-8")
    print("Local configuration prepared. Credentials: pilot/.local/ACCESS.txt")


def shell_script(filename):
    # Script name is a fixed internal name, never external input.
    code = "exec(compile(open('/opt/ma2f/" + filename + "').read(), '" + filename + "', 'exec'))"
    subprocess.run(
        ["docker", "compose", "-f", str(ROOT / "compose.yaml"), "run", "--rm", "-T",
         "--no-deps", "odoo", "odoo", "shell", "--no-http", "-d", "ma2f_pilot"],
        input=code, text=True, cwd=ROOT, check=True, timeout=300,
    )


def check():
    token = (LOCAL / "gateway-token").read_text().strip()
    for route in ["products", "stock"]:
        req = Request("http://127.0.0.1:18080/v1/pilot/" + route,
                      headers={"Authorization": "Bearer " + token})
        with urlopen(req, timeout=15) as response:
            data = json.load(response)
            assert data["source"] == "odoo" and isinstance(data["data"], list), "Invalid Odoo response"
            if route == "products":
                assert len(data["data"]) == 2, "Missing pilot products"
            print(route + ": live Odoo data received")
    try:
        urlopen("http://127.0.0.1:18080/v1/pilot/stock", timeout=10)
    except HTTPError as exc:
        assert exc.code == 401, "Unexpected anonymous response"
    else:
        raise RuntimeError("Anonymous stock access must be denied")
    print("Anonymous access denied. Pilot read boundary verified.")
    for route in ["/json/2/product.product/search_read", "/jsonrpc", "/xmlrpc/2/object", "/web/database/manager"]:
        try:
            urlopen("http://127.0.0.1:18069" + route, timeout=10)
        except HTTPError as exc:
            assert exc.code == 404, "Unexpected admin ingress response"
        else:
            raise RuntimeError("Generic API/database manager exposed at admin ingress")
    print("Generic Odoo APIs and database manager denied at admin ingress.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "init", "upgrade", "up", "check", "scenario",
                                         "commands-test", "business-test", "lots-test", "live-test", "packs-live-test", "backup-test", "enable-production", "disable-production", "stop", "status"])
    action = parser.parse_args().action
    if action == "prepare":
        prepare()
        return
    if action in ["init", "upgrade", "up"]:
        prepare()
    if action == "disable-production":
        # Close the HTTP boundary even when the Docker engine is currently unavailable.
        LOCAL.mkdir(exist_ok=True)
        (LOCAL / "production-enabled").write_text("false")
    subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"],
                   check=True, timeout=20, stdout=subprocess.DEVNULL)
    if action == "init":
        if (LOCAL / "initialized.json").exists():
            print("Pilot already initialized; use 'up'. Existing data are preserved.")
            return
        compose("up", "-d", "--wait", "db")
        compose("run", "--rm", "-T", "--no-deps", "odoo", "odoo", "-d", "ma2f_pilot",
                "-i", MODULES, "--without-demo=True", "--stop-after-init", "--no-http")
        shell_script("bootstrap.py")
        compose("up", "-d", "odoo", "gateway", "ingress")
    elif action == "up":
        if not (LOCAL / "initialized.json").exists():
            raise RuntimeError("Run init first: the default Odoo account must be replaced before exposing the service.")
        compose("up", "-d")
    elif action == "upgrade":
        if not (LOCAL / "initialized.json").exists():
            raise RuntimeError("Initialize the pilot first")
        (LOCAL / "production-enabled").write_text("false")
        compose("stop", "ingress", "gateway", "odoo")
        compose("up", "-d", "--wait", "db")
        compose("run", "--rm", "-T", "--no-deps", "odoo", "odoo", "-d", "ma2f_pilot",
                "-i", MODULES, "-u", "ma2f_pilot_access,ma2f_pilot_commands",
                "--without-demo=True", "--stop-after-init", "--no-http")
        shell_script("bootstrap.py")
        compose("up", "-d", "odoo", "gateway", "ingress")
    elif action == "check":
        check()
    elif action == "scenario":
        shell_script("scenario.py")
    elif action == "commands-test":
        shell_script("commands_scenario.py")
    elif action == "business-test":
        shell_script("business_scenario.py")
    elif action == "lots-test":
        shell_script("lots_scenario.py")
    elif action == "live-test":
        from live_test import run
        run(LOCAL, shell_script)
    elif action == "packs-live-test":
        from packs_live_test import run
        run(LOCAL, shell_script)
    elif action == "backup-test":
        (LOCAL / "production-enabled").write_text("false")
        shell_script("disable_production.py")
        compose("stop", "ingress", "gateway", "odoo")
        try:
            shell_script("backup_restore.py")
        finally:
            compose("up", "-d", "odoo", "gateway", "ingress")
    elif action == "enable-production":
        subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "gateway"),
                        "-p", "test_*.py"], check=True, timeout=120)
        shell_script("enable_production.py")
    elif action == "disable-production":
        (LOCAL / "production-enabled").write_text("false")
        shell_script("disable_production.py")
    elif action == "stop":
        compose("stop")
    elif action == "status":
        compose("ps", timeout=30)


if __name__ == "__main__":
    try:
        main()
    except (subprocess.SubprocessError, OSError, RuntimeError, AssertionError, URLError) as exc:
        print("Pilot command failed: " + str(exc), file=sys.stderr)
        sys.exit(1)
