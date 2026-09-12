"""Trusted local MA2F backend client. Never put these tokens in a browser.

No Firebase dependency, local stock arithmetic, automatic UUID replacement or
fallback write. The caller must persist a request ID before submitting production.
"""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class MA2FClient:
    def __init__(self, base_url, reader_token, writer_token):
        self.base_url = base_url.rstrip('/')
        self.reader_token, self.writer_token = reader_token, writer_token

    def stock(self):
        request = Request(self.base_url + '/v1/ma2f/stock',
            headers={'Authorization': 'Bearer ' + self.reader_token})
        with urlopen(request, timeout=35) as response:
            result = json.load(response)
        if result.get('source') != 'odoo' or not isinstance(result.get('data'), dict):
            raise ValueError('Invalid Odoo stock result')
        return result['data']

    def produce(self, command):
        # The gateway and Odoo independently validate the exact contract.
        request = Request(self.base_url + '/v1/ma2f/production', data=json.dumps(command).encode(),
            headers={'Authorization': 'Bearer ' + self.writer_token, 'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=35) as response:
                result = json.load(response)
                if (not isinstance(result, dict) or result.get('source') != 'odoo'
                        or not isinstance(result.get('data'), dict)
                        or result['data'].get('state') != 'done'
                        or result['data'].get('request_id') != command['request_id']):
                    raise ValueError('Invalid production result')
                return response.status, result
        except HTTPError as exc:
            try:
                result = json.load(exc)
                if not isinstance(result, dict):
                    raise ValueError('Invalid error response')
                return exc.code, result
            except ValueError:
                return self._unknown(command)
        except (URLError, OSError, ValueError):
            return self._unknown(command)

    @staticmethod
    def _unknown(command):
        # A transport failure does not prove the transaction was rolled back.
        return 503, {'error': 'transport_result_unknown', 'outcome': 'unknown',
                     'request_id': command['request_id'], 'retry_with_same_request_id': True}
