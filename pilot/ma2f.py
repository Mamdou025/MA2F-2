"""Local operator entry point for the connected production/stock backend."""
import argparse
import json
from pathlib import Path
import sys
from uuid import uuid4, UUID

from ma2f_client import MA2FClient

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'addons' / 'ma2f_pilot_commands'))
from production_contract import validate_pack_production


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('stock')
    prepare = sub.add_parser('prepare-production')
    prepare.add_argument('--packs', type=int, required=True)
    prepare.add_argument('--rejects', type=int, default=0)
    prepare.add_argument('--kg', required=True)
    submit = sub.add_parser('submit-production')
    submit.add_argument('request_id')
    args = parser.parse_args()
    local = ROOT / '.local'
    requests = local / 'production-requests'
    if args.action == 'prepare-production':
        command = validate_pack_production({'request_id': str(uuid4()), 'saleable_packs': args.packs,
                                            'rejected_sachets': args.rejects, 'consumed_kg': args.kg})
        requests.mkdir(exist_ok=True)
        with (requests / (command['request_id'] + '.json')).open('x', encoding='utf-8') as stream:
            json.dump(command, stream, indent=2)
        print(json.dumps({'status': 'prepared_not_submitted', 'command': command}))
        return
    client = MA2FClient('http://127.0.0.1:18080', (local / 'gateway-token').read_text().strip(),
                        (local / 'gateway-writer-token').read_text().strip())
    if args.action == 'stock':
        print(json.dumps({'source': 'odoo', 'stock': client.stock()}, indent=2))
        return
    request_id = str(UUID(args.request_id))
    command = validate_pack_production(json.loads((requests / (request_id + '.json')).read_text()))
    if command['request_id'] != request_id:
        raise ValueError('Saved request ID mismatch')
    status, result = client.produce(command)
    (requests / (request_id + '.result.json')).write_text(json.dumps({'http_status': status, 'result': result}, indent=2))
    print(json.dumps({'http_status': status, 'result': result}, indent=2))
    return 0 if status == 200 else 1


if __name__ == '__main__':
    try:
        sys.exit(main() or 0)
    except (OSError, ValueError) as exc:
        print('MA2F command unavailable: ' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
