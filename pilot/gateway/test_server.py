import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from server import Handler


class GatewayBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.secret_patch = patch("server.Path.read_text", return_value="test-secret")
        self.secret_patch.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.secret_patch.stop()

    def request(self, path, method="GET", token=None):
        headers = {"Authorization": "Bearer " + token} if token else {}
        req = Request(self.url + path, headers=headers, method=method)
        try:
            response = urlopen(req, timeout=2)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.load(response)

    @patch("server.read_odoo")
    def test_no_token_never_reaches_odoo(self, read):
        self.assertEqual(self.request("/v1/pilot/stock")[0], 401)
        self.assertEqual(self.request("/v1/pilot/stock", token="wrong")[0], 401)
        read.assert_not_called()

    @patch("server.read_odoo")
    def test_write_and_generic_proxy_are_forbidden(self, read):
        for method in ["POST", "PUT", "PATCH", "DELETE"]:
            self.assertEqual(self.request("/v1/pilot/stock", method, "test-secret")[0], 405)
        for path in ["/json/2/res.users/search_read", "/v1/pilot/stock?model=res.users"]:
            self.assertEqual(self.request(path, token="test-secret")[0], 404)
        read.assert_not_called()

    @patch("server.read_odoo", return_value=[{"quantity": 10}])
    def test_allowed_read_is_bounded(self, read):
        status, body = self.request("/v1/pilot/stock", token="test-secret")
        self.assertEqual(status, 200)
        self.assertEqual(body["data"], [{"quantity": 10}])
        self.assertEqual(read.call_args.args[0], "stock.quant")
        self.assertEqual(read.call_args.args[1]["limit"], 100)

    @patch("server.read_odoo", side_effect=URLError("private internal traceback"))
    def test_upstream_failure_is_explicit_and_redacted(self, read):
        status, body = self.request("/v1/pilot/stock", token="test-secret")
        self.assertEqual(status, 503)
        self.assertNotIn("private", json.dumps(body))

    @patch("server.read_odoo")
    def test_liveness_does_not_claim_odoo_readiness(self, read):
        status, body = self.request("/health")
        self.assertEqual(status, 200)
        self.assertFalse(body["odoo_checked"])
        read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
