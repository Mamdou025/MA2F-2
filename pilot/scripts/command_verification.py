from hashlib import sha256
from pathlib import Path


def code_fingerprint():
    root = Path("/mnt/extra-addons/ma2f_pilot_commands")
    digest = sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix in {".py", ".xml", ".csv"}:
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()
