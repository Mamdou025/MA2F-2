"""Confirmed MA2F production semantics, independent from the historical app.

Production input is saleable packs, after manufacturing rejects were removed.
This conversion does not create Odoo stock moves or rewrite historical data.
"""

SACHETS_PER_PACK = 30


def production_quantities(saleable_packs, rejected_sachets=0):
    if type(saleable_packs) is not int or saleable_packs <= 0:
        raise ValueError('Saleable packs must be a positive integer')
    if type(rejected_sachets) is not int or rejected_sachets < 0:
        raise ValueError('Rejected sachets must be a nonnegative integer')
    saleable_sachets = saleable_packs * SACHETS_PER_PACK
    return {
        'saleable_packs': saleable_packs,
        'saleable_sachets': saleable_sachets,
        'rejected_sachets': rejected_sachets,
        'gross_sachets': saleable_sachets + rejected_sachets,
    }
