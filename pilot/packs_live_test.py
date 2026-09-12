"""Use the MA2F backend client against real Odoo, including simultaneous retries."""
from concurrent.futures import ThreadPoolExecutor
import json
from threading import Barrier
from ma2f_client import MA2FClient


def run(local, shell_script):
    report = local / 'packs-live-result.json'
    report.write_text(json.dumps({'status': 'running'}))
    shell_script('live_fixture.py')
    fixture = json.loads((local / 'live-fixture.json').read_text())
    reader = (local / 'gateway-token').read_text().strip()
    writer = (local / 'gateway-writer-token').read_text().strip()
    client = MA2FClient('http://127.0.0.1:18080', reader, writer)
    before = client.stock()
    command = {'request_id': fixture['request_ids'][0], 'saleable_packs': 100,
               'rejected_sachets': 12, 'consumed_kg': '0.60'}
    # Persist intent before any HTTP write, exactly as a future trusted MA2F backend must.
    (local / 'packs-live-command.json').write_text(json.dumps(command))
    try:
        shell_script('enable_production.py')
        unauthorized = MA2FClient('http://127.0.0.1:18080', reader, reader)
        assert unauthorized.produce(command)[0] == 403
        barrier = Barrier(6)
        def send():
            barrier.wait(timeout=10)
            return client.produce(command)
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(send) for _ in range(6)]
            responses = [future.result() for future in futures]
        assert all(status == 200 for status, _ in responses), [status for status, _ in responses]
        results = [body['data'] for _, body in responses]
        assert len({r['production_id'] for r in results}) == 1
        assert len({r['scrap_id'] for r in results}) == 1
        assert sum(not r['replayed'] for r in results) == 1
        assert all(r['gross_sachets'] == 3012 and r['saleable_sachets'] == 3000 for r in results)
        status, replay = client.produce(command)
        assert status == 200 and replay['data']['replayed']
        status, conflict = client.produce(dict(command, rejected_sachets=13))
        assert status == 409 and conflict['error'] == 'MA2F_REQUEST_CONFLICT'
        after = client.stock()
        assert after['sachets']['on_hand'] - before['sachets']['on_hand'] == 3000
        assert abs(after['film_kg']['on_hand'] - before['film_kg']['on_hand'] + .6) < .0001
        assert after['available_whole_packs'] - before['available_whole_packs'] == 100
        assert after['available_loose_sachets'] == before['available_loose_sachets']
    except Exception:
        report.write_text(json.dumps({'status': 'failed'}))
        raise
    finally:
        (local / 'production-enabled').write_text('false')
        shell_script('disable_production.py')
    assert client.produce(command)[0] == 403
    shell_script('packs_live_verify.py')
