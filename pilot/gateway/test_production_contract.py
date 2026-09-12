import json
import unittest

import server  # Resolves the shared contract in local and container environments.
from production_contract import InvalidCommand, command_fingerprint, decode_command, validate_production

VALID = {"request_id": "0466b1a4-0c85-4bce-b158-4f3d64c4c729", "produced_units": 300, "consumed_kg": "0.50"}


class ProductionContractTests(unittest.TestCase):
    def test_equivalent_decimal_spellings_have_same_fingerprint(self):
        self.assertEqual(command_fingerprint(VALID), command_fingerprint(dict(VALID, consumed_kg="0.5")))
        self.assertNotEqual(command_fingerprint(VALID), command_fingerprint(dict(VALID, consumed_kg="0.6")))

    def test_non_integer_boolean_and_out_of_range_units_are_rejected(self):
        for value in [True, False, 0, -1, 1.5, "300", 100001, None]:
            with self.subTest(value=value), self.assertRaises(InvalidCommand):
                validate_production(dict(VALID, produced_units=value))

    def test_weights_require_positive_bounded_exact_decimal_strings(self):
        for value in [0.5, "0", "-1", "NaN", "Infinity", "1e2", "0.001", "1000.01", " 1", "01", None]:
            with self.subTest(value=value), self.assertRaises(InvalidCommand):
                validate_production(dict(VALID, consumed_kg=value))

    def test_caller_cannot_supply_identity_model_company_or_location(self):
        for key in ["actor", "uid", "company_id", "model", "product_id", "location_id", "context"]:
            with self.subTest(key=key), self.assertRaises(InvalidCommand):
                validate_production(dict(VALID, **{key: "arbitrary"}))

    def test_id_is_required_and_strict(self):
        for value in ["", "not-a-uuid", 1, None, "0466b1a40c854bceb1584f3d64c4c729"]:
            with self.subTest(value=value), self.assertRaises(InvalidCommand):
                validate_production(dict(VALID, request_id=value))

    def test_duplicate_keys_nonfinite_and_large_json_are_rejected(self):
        for body in [b'{"produced_units":1,"produced_units":2}', b'{"produced_units":NaN}',
                     b'[]', b'null', b'{}', b'\xff', b' ' * 4097]:
            with self.subTest(body=body[:40]), self.assertRaises(InvalidCommand):
                decode_command(body)

    def test_valid_body_normalizes_to_sachets_and_kilograms(self):
        self.assertEqual(decode_command(json.dumps(VALID).encode()), VALID)


if __name__ == "__main__":
    unittest.main()
