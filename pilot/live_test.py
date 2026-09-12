"""Real concurrent HTTP test. Uses pilot tokens only, never Firebase."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, ROUND_DOWN
import json
from threading import Barrier
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def run(local, shell_script):
    (local / 'live-result.json').write_text(json.dumps({'status': 'running'}))
    shell_script('live_fixture.py')
    fixture = json.loads((local / 'live-fixture.json').read_text())
    token = (local / 'gateway-writer-token').read_text().strip()

    def send(command, barrier=None):
        if barrier:
            barrier.wait(timeout=10)
        request = Request('http://127.0.0.1:18080/v1/pilot/production',
            data=json.dumps(command).encode(), headers={
                'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=40) as response:
                return response.status, json.load(response)
        except HTTPError as exc:
            return exc.code, json.load(exc)

    def parallel(commands):
        barrier = Barrier(len(commands))
        with ThreadPoolExecutor(max_workers=len(commands)) as pool:
            futures = [pool.submit(send, command, barrier) for command in commands]
            return [future.result() for future in futures]

    try:
        shell_script('enable_production.py')
        command = {'request_id': fixture['request_ids'][0], 'produced_units': 300, 'consumed_kg': '0.60'}
        responses = parallel([command] * 6)
        assert all(status == 200 for status, _ in responses), [status for status, _ in responses]
        results = [body['data'] for _, body in responses]
        assert len({r['production_id'] for r in results}) == 1
        assert sum(not r['replayed'] for r in results) == 1
        # Discard the original successful response and retry the same command.
        status, retried = send(command)
        assert status == 200 and retried['data']['replayed']
        status, conflict = send(dict(command, produced_units=301))
        assert status == 409 and conflict['error'] == 'MA2F_REQUEST_CONFLICT'
        available = Decimal(str(fixture['initial_kg'])) + Decimal('1.4')
        competing = (available * Decimal('0.75')).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
        responses = parallel([{'request_id': rid, 'produced_units': 100, 'consumed_kg': str(competing)}
                              for rid in fixture['request_ids'][1:]])
        assert sorted(status for status, _ in responses) == [200, 409]
        assert next(body for status, body in responses if status == 409)['error'] == 'MA2F_INSUFFICIENT_STOCK'
        (local / 'live-responses.json').write_text(json.dumps({
            'http_checks_passed': True, 'competing_kg': str(competing)}))
    except Exception:
        (local / 'live-result.json').write_text(json.dumps({'status': 'failed'}))
        raise
    finally:
        (local / 'production-enabled').write_text('false')
        shell_script('disable_production.py')
    shell_script('live_verify.py')
