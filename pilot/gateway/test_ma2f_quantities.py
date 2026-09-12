from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ma2f_quantities import production_quantities


class MA2FQuantityTests(unittest.TestCase):
    def test_confirmed_example_is_3000_saleable_sachets(self):
        self.assertEqual(production_quantities(100), {
            'saleable_packs': 100, 'saleable_sachets': 3000,
            'rejected_sachets': 0, 'gross_sachets': 3000})

    def test_rejects_are_not_subtracted_from_saleable_stock_twice(self):
        quantities = production_quantities(100, 12)
        self.assertEqual(quantities['saleable_sachets'], 3000)
        self.assertEqual(quantities['gross_sachets'], 3012)
        self.assertEqual(quantities['rejected_sachets'], 12)

    def test_sachet_rejects_need_not_form_a_whole_pack(self):
        self.assertEqual(production_quantities(1, 1)['gross_sachets'], 31)

    def test_invalid_units_cannot_be_silently_converted(self):
        for value in [True, 0, -1, 1.5, '100', None]:
            with self.subTest(packs=value), self.assertRaises(ValueError):
                production_quantities(value)
        for value in [True, -1, 1.5, '12', None]:
            with self.subTest(rejects=value), self.assertRaises(ValueError):
                production_quantities(100, value)
