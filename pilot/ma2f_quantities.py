"""Compatibility import for the shared MA2F pack conversion."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent / 'addons' / 'ma2f_pilot_commands'))
from pack_quantities import SACHETS_PER_PACK, production_quantities
