import io
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import BusinessRejection, Handler, write_production
from test_production_contract import VALID


class ProductionHTTPTests(unittest.TestCase):
    def setUp(self):
        secrets = {"gateway_token": "reader", "gateway_writer_token": "writer", "production_enabled": "true"}
        self.secret_patch = patch("server.load_secret", side_effect=lambda name: secrets.get(name, ""))
        self.secret_patch.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port) + "/v1/pilot/production"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.secret_patch.stop()

    def request(self, token="writer", body=None, content_type="application/json"):
        headers = {"Content-Type": content_type}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = Request(self.url, data=body if body is not None else json.dumps(VALID).encode(),
                      headers=headers, method="POST")
        try:
            response = urlopen(req, timeout=3)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.load(response)

    @patch("server.write_production")
    def test_reader_and_anonymous_cannot_produce(self, write):
        self.assertEqual(self.request(token="reader")[0], 403)
        self.assertEqual(self.request(token=None)[0], 401)
        write.assert_not_called()

    @patch("server.write_production")
    @patch("server.production_enabled", return_value=False)
    def test_write_gate_is_closed_by_default(self, enabled, write):
        self.assertEqual(self.request()[0], 403)
        write.assert_not_called()

    @patch("server.write_production")
    def test_invalid_requests_never_reach_odoo(self, write):
        self.assertEqual(self.request(body=json.dumps(dict(VALID, actor="admin")).encode())[0], 400)
        self.assertEqual(self.request(body=b"x" * 4097)[0], 413)
        self.assertEqual(self.request(content_type="text/plain")[0], 415)
        write.assert_not_called()

    @patch("server.write_production", return_value=dict(VALID, state="done", production_id=42, replayed=False))
    def test_only_validated_command_is_forwarded(self, write):
        status, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["production_id"], 42)
        write.assert_called_once_with(VALID)

    @patch("server.write_production", side_effect=TimeoutError("internal server details"))
    def test_timeout_keeps_request_id_and_reports_unknown_outcome(self, write):
        status, body = self.request()
        self.assertEqual(status, 503)
        self.assertEqual(body["request_id"], VALID["request_id"])
        self.assertEqual(body["outcome"], "unknown")
        self.assertTrue(body["retry_with_same_request_id"])
        self.assertNotIn("internal", json.dumps(body))

    @patch("server.write_production", side_effect=BusinessRejection("MA2F_REQUEST_CONFLICT", 409))
    def test_business_refusal_is_not_reported_as_success(self, write):
        status, body = self.request()
        self.assertEqual(status, 409)
        self.assertEqual(body["outcome"], "not_applied")

    @patch("server.write_production", return_value={"state": "draft"})
    def test_unvalidated_odoo_result_is_not_success(self, write):
        status, body = self.request()
        self.assertEqual(status, 503)
        self.assertEqual(body["outcome"], "unknown")


class OdooErrorBoundaryTests(unittest.TestCase):
    def test_known_odoo_error_is_translated_without_traceback(self):
        error = HTTPError("http://private", 400, "failure", {}, io.BytesIO(json.dumps({
            "name": "odoo.exceptions.UserError", "message": "MA2F_INSUFFICIENT_STOCK",
            "debug": "private traceback",
        }).encode()))
        with patch("server.call_odoo", side_effect=error), self.assertRaises(BusinessRejection) as caught:
            write_production(VALID)
        self.assertEqual(caught.exception.code, "MA2F_INSUFFICIENT_STOCK")


if __name__ == "__main__":
    unittest.main()
