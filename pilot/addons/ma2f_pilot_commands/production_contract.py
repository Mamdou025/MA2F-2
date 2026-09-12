"""Shared pilot command contract: no Odoo dependency, no side effects."""

from decimal import Decimal
import hashlib
import json
import re
from uuid import UUID

if __package__:
    from .pack_quantities import production_quantities
else:
    from pack_quantities import production_quantities

REQUIRED = {"request_id", "produced_units", "consumed_kg"}
MAX_BODY_BYTES = 4096


class InvalidCommand(ValueError):
    pass


def validate_production(command):
    if not isinstance(command, dict) or set(command) != REQUIRED:
        raise InvalidCommand("Exactly request_id, produced_units and consumed_kg are required")
    request_id = command["request_id"]
    if not isinstance(request_id, str) or len(request_id) != 36:
        raise InvalidCommand("request_id must be a UUID")
    try:
        canonical_id = str(UUID(request_id))
    except ValueError as exc:
        raise InvalidCommand("request_id must be a UUID") from exc
    if request_id.lower() != canonical_id:
        raise InvalidCommand("request_id must be a canonical UUID")
    units = command["produced_units"]
    if type(units) is not int or not 1 <= units <= 100_000:
        raise InvalidCommand("produced_units must be an integer between 1 and 100000")
    kg = command["consumed_kg"]
    if not isinstance(kg, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,2})?", kg):
        raise InvalidCommand("consumed_kg must be a decimal string with at most two decimal places")
    amount = Decimal(kg)
    if not Decimal("0") < amount <= Decimal("1000"):
        raise InvalidCommand("consumed_kg must be greater than zero and at most 1000")
    return {"request_id": canonical_id, "produced_units": units,
            "consumed_kg": format(amount, ".2f")}


def command_fingerprint(command):
    canonical = validate_production(command)
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_pack_production(command):
    required = {'request_id', 'saleable_packs', 'rejected_sachets', 'consumed_kg'}
    if not isinstance(command, dict) or set(command) != required:
        raise InvalidCommand('Exactly request_id, saleable_packs, rejected_sachets and consumed_kg are required')
    try:
        quantities = production_quantities(command['saleable_packs'], command['rejected_sachets'])
    except ValueError as exc:
        raise InvalidCommand(str(exc)) from exc
    base = validate_production({'request_id': command['request_id'],
        'produced_units': quantities['gross_sachets'], 'consumed_kg': command['consumed_kg']})
    return {'request_id': base['request_id'], 'saleable_packs': quantities['saleable_packs'],
            'rejected_sachets': quantities['rejected_sachets'], 'consumed_kg': base['consumed_kg']}


def pack_fingerprint(command):
    data = dict(validate_pack_production(command), contract='ma2f-packs-v1')
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def decode_command(body, validator=validate_production):
    if len(body) > MAX_BODY_BYTES:
        raise InvalidCommand("Request body too large")

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise InvalidCommand("Duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(value):
        raise InvalidCommand("Non-finite JSON number")

    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=unique_object,
                           parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise InvalidCommand("Invalid JSON command") from exc
    return validator(value)
