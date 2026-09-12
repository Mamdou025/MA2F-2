import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import server
from production_contract import InvalidCommand, validate_pack_production, pack_fingerprint, decode_command
import test_production_http as legacy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ma2f_client import MA2FClient

PACK = {'request_id': '0466b1a4-0c85-4bce-b158-4f3d64c4c729', 'saleable_packs': 100,
        'rejected_sachets': 12, 'consumed_kg': '0.60'}


class PackContractTests(unittest.TestCase):
    def test_reject_count_is_part_of_idempotency(self):
        self.assertNotEqual(pack_fingerprint(PACK), pack_fingerprint(dict(PACK, rejected_sachets=13)))
        self.assertEqual(pack_fingerprint(PACK), pack_fingerprint(dict(PACK, consumed_kg='0.6')))

    def test_units_and_bounds(self):
        for changes in [{'saleable_packs': True}, {'saleable_packs': 0}, {'saleable_packs': 3334},
                        {'rejected_sachets': -1}, {'rejected_sachets': 1.5}, {'rejected_sachets': 100001},
                        {'saleable_packs': 3333, 'rejected_sachets': 11}, {'consumed_kg': .6},
                        {'produced_units': 3000}, {'actor': 'admin'}]:
            with self.subTest(changes=changes), self.assertRaises(InvalidCommand):
                validate_pack_production(dict(PACK, **changes))

    def test_pack_json_rejects_duplicate_keys(self):
        body = json.dumps(PACK).replace('"rejected_sachets": 12', '"rejected_sachets": 12, "rejected_sachets": 0').encode()
        with self.assertRaises(InvalidCommand):
            decode_command(body, validate_pack_production)


class PackHTTPTests(unittest.TestCase):
    def setUp(self):
        legacy.ProductionHTTPTests.setUp(self)
        self.url = self.url.replace('/v1/pilot/production', '/v1/ma2f/production')

    tearDown = legacy.ProductionHTTPTests.tearDown

    def request(self, **kwargs):
        kwargs.setdefault('body', json.dumps(PACK).encode())
        return legacy.ProductionHTTPTests.request(self, **kwargs)

    @patch('server.write_production', return_value=dict(PACK, state='done'))
    def test_correct_native_method_receives_pack_contract(self, write):
        self.assertEqual(self.request()[0], 200)
        write.assert_called_once_with(PACK, method='record_pack_production')

    @patch('server.write_production')
    def test_reader_and_invalid_input_never_write(self, write):
        self.assertEqual(self.request(token='reader')[0], 403)
        self.assertEqual(self.request(body=json.dumps(dict(PACK, rejected_sachets=-1)).encode())[0], 400)
        write.assert_not_called()

    @patch('server.production_enabled', return_value=False)
    @patch('server.write_production')
    def test_pack_write_gate(self, write, enabled):
        self.assertEqual(self.request()[0], 403)
        write.assert_not_called()


class TrustedClientTests(unittest.TestCase):
    def test_lost_response_preserves_identity_without_fallback_or_automatic_retry(self):
        with patch('ma2f_client.urlopen', side_effect=TimeoutError()) as send:
            status, result = MA2FClient('http://local', 'read', 'write').produce(PACK)
        self.assertEqual(status, 503)
        self.assertEqual(result['request_id'], PACK['request_id'])
        self.assertEqual(result['outcome'], 'unknown')
        self.assertEqual(send.call_count, 1)

    def test_html_proxy_failure_is_an_unknown_result(self):
        error = HTTPError('http://local', 502, 'Bad Gateway', {}, io.BytesIO(b'<html>error</html>'))
        with patch('ma2f_client.urlopen', side_effect=error):
            status, result = MA2FClient('http://local', 'read', 'write').produce(PACK)
        self.assertEqual(status, 503)
        self.assertTrue(result['retry_with_same_request_id'])
