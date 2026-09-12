"""Local pilot: bounded reads and one opt-in production command. Never a generic proxy."""

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# One shared contract: local source path, or the same file mounted into /app in Docker.
contract_dir = Path(__file__).resolve().parents[1] / "addons" / "ma2f_pilot_commands"
if contract_dir.is_dir():
    sys.path.insert(0, str(contract_dir))
from production_contract import InvalidCommand, MAX_BODY_BYTES, decode_command, validate_pack_production


ROUTES = {
    "/v1/pilot/products": (
        "product.product",
        {"domain": [["default_code", "=like", "MA2F-PILOT-%"]],
         "fields": ["id", "name", "default_code", "uom_id"], "limit": 100, "order": "id"},
    ),
    "/v1/pilot/stock": (
        "stock.quant",
        {"domain": [["product_id.default_code", "=like", "MA2F-PILOT-%"],
                    ["location_id.usage", "=", "internal"]],
         "fields": ["id", "product_id", "location_id", "quantity", "reserved_quantity"],
         "limit": 100, "order": "id"},
    ),
}


def authorized(header, token):
    return bool(token) and hmac.compare_digest((header or "").encode(), ("Bearer " + token).encode())


def load_secret(name):
    try:
        return Path("/run/secrets/" + name).read_text().strip()
    except OSError:
        return ""


def production_enabled():
    return load_secret("production_enabled") == "true"


def call_odoo(model, method, payload, key_name):
    key = load_secret(key_name)
    if not key:
        raise ValueError("Pilot has not been initialized")
    url = os.environ["ODOO_URL"].rstrip("/") + "/json/2/" + model + "/" + method
    req = Request(url, data=json.dumps(payload).encode(), headers={
        "Authorization": "Bearer " + key,
        "X-Odoo-Database": os.environ["ODOO_DATABASE"],
        "Content-Type": "application/json",
    }, method="POST")
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def read_odoo(model, payload):
    return call_odoo(model, "search_read", payload, "odoo_api_key")


class BusinessRejection(Exception):
    def __init__(self, code, status):
        self.code, self.status = code, status


BUSINESS_ERRORS = {
    "MA2F_FORBIDDEN": 403, "MA2F_PILOT_ONLY": 403, "MA2F_WRITES_DISABLED": 403,
    "MA2F_INVALID_COMMAND": 422, "MA2F_REQUEST_CONFLICT": 409,
    "MA2F_INSUFFICIENT_STOCK": 409, "MA2F_UNSUPPORTED_CONFIGURATION": 409,
    "MA2F_VALIDATION_REQUIRED": 409, "MA2F_NOT_CONFIGURED": 409,
    "MA2F_INCOMPLETE_OPERATION": 409,
}


def write_production(command, method="record_production"):
    try:
        return call_odoo("ma2f.pilot.operation", method,
                         {"command": command}, "odoo_writer_key")
    except HTTPError as exc:
        try:
            error = json.loads(exc.read(65536))
        except (ValueError, OSError):
            raise exc
        if (isinstance(error, dict)
                and error.get("name") in {"odoo.exceptions.UserError", "odoo.exceptions.ValidationError",
                                          "odoo.exceptions.AccessError"}
                and isinstance(error.get("message"), str)
                and error.get("message") in BUSINESS_ERRORS):
            code = error["message"]
            raise BusinessRejection(code, BUSINESS_ERRORS[code]) from exc
        raise


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"service": "ma2f-pilot-gateway", "mode": "pilot-production" if production_enabled() else "read-only",
                             "status": "alive", "odoo_checked": False})
            return
        token = load_secret("gateway_token")
        if not authorized(self.headers.get("Authorization"), token):
            self.reply(401, {"error": "authentication_required"})
            return
        route = ROUTES.get(self.path)
        if self.path == '/v1/ma2f/stock':
            try:
                data = call_odoo('ma2f.pilot.operation', 'get_pack_stock', {}, 'odoo_api_key')
                self.reply(200, {'data': data, 'source': 'odoo'})
            except (HTTPError, URLError, TimeoutError, ValueError, OSError):
                self.reply(503, {'error': 'odoo_unavailable', 'retryable': True})
            return
        if route is None:
            self.reply(404, {"error": "route_not_allowed"})
            return
        try:
            self.reply(200, {"data": read_odoo(*route), "source": "odoo", "limit": 100})
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            # Never leak Odoo traceback, configuration or credentials to the caller.
            self.reply(503, {"error": "odoo_unavailable", "retryable": True})

    def do_POST(self):
        packs = self.path == '/v1/ma2f/production'
        if self.path != "/v1/pilot/production" and not packs:
            self.reject_write()
            return
        header = self.headers.get("Authorization")
        if not authorized(header, load_secret("gateway_writer_token")):
            status = 403 if authorized(header, load_secret("gateway_token")) else 401
            self.reply(status, {"error": "production_permission_required"})
            return
        if not production_enabled():
            self.reply(403, {"error": "production_disabled"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1:
            self.reply(400, {"error": "content_length_required"})
            return
        try:
            length = int(lengths[0])
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY_BYTES:
            self.reply(413 if length > MAX_BODY_BYTES else 400, {"error": "invalid_body_size"})
            return
        if self.headers.get_content_type() != "application/json":
            self.reply(415, {"error": "application_json_required"})
            return
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise InvalidCommand("Incomplete request")
            command = decode_command(body, validate_pack_production) if packs else decode_command(body)
        except (InvalidCommand, TimeoutError, OSError):
            self.reply(400, {"error": "invalid_production_command"})
            return
        try:
            result = write_production(command, method='record_pack_production') if packs else write_production(command)
            if not isinstance(result, dict) or result.get("state") != "done" or result.get("request_id") != command["request_id"]:
                raise ValueError("Invalid Odoo result")
            self.reply(200, {"data": result, "source": "odoo"})
            self.audit_command(command, "replayed" if result.get("replayed") else "done")
        except BusinessRejection as exc:
            self.audit_command(command, "rejected", exc.code)
            self.reply(exc.status, {"error": exc.code, "request_id": command["request_id"],
                                    "outcome": "not_applied"})
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            self.audit_command(command, "unknown")
            # A timeout can occur after commit. Never claim the write failed or generate a new UUID.
            self.reply(503, {"error": "odoo_result_unknown", "request_id": command["request_id"],
                             "outcome": "unknown", "retry_with_same_request_id": True})

    def reject_write(self):
        self.reply(405, {"error": "operation_not_allowed"})

    def audit_command(self, command, outcome, code=None):
        print(json.dumps({"event": "pilot_production", "request_id": command["request_id"],
                          "actor": "pilot:operator", "outcome": outcome, "code": code}), flush=True)

    do_PUT = do_PATCH = do_DELETE = reject_write

    def log_message(self, format, *args):
        # Request paths can contain user-supplied secrets. Log only the response code.
        if len(args) >= 2:
            print("gateway response", args[1], flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
