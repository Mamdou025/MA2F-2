"""Pinned OCA source installation and snapshot-safe runtime integrity verification."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent

def digest(files):
    h = hashlib.sha256()
    for name, content in sorted(files.items()):
        h.update(name.encode() + b'\0' + hashlib.sha256(content).digest())
    return h.hexdigest()

def archive_files(payload, modules):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe archive path')
            relative = path.parts[1:]
            if not relative or relative[0] not in modules or member.isdir():
                continue
            if not member.isfile() or member.size > 20_000_000:
                raise ValueError('Unsupported archive entry')
            name = '/'.join(relative)
            if name in files:
                raise ValueError('Duplicate archive path')
            files[name] = archive.extractfile(member).read()
    for module in modules:
        if module + '/__manifest__.py' not in files:
            raise ValueError('Missing selected module')
    return files

def lock():
    return json.loads((ROOT / 'community-release.json').read_text())

def current_files(destination, modules):
    files = {}
    for module in modules:
        folder = destination / module
        if not folder.is_dir() or folder.is_symlink():
            return {}
        for path in folder.rglob('*'):
            if '__pycache__' in path.parts or path.suffix == '.pyc':
                continue
            if path.is_symlink():
                raise ValueError('Unexpected source symlink')
            if path.is_file():
                files[path.relative_to(destination).as_posix()] = path.read_bytes()
    return files

def verified_addons_path():
    destination = ROOT / '.local/community-addons'
    for repo, item in lock().items():
        if digest(current_files(destination, item['modules'])) != item['tree_sha256']:
            raise ValueError('Community source verification failed: ' + repo)
    return str(destination)

def install():
    os.umask(0o077)
    destination = ROOT / '.local/community-addons'
    destination.mkdir(parents=True, exist_ok=True)
    for repo, item in lock().items():
        existing = current_files(destination, item['modules'])
        if digest(existing) == item['tree_sha256']:
            print('COMMUNITY_SOURCE_VERIFIED ' + repo, flush=True)
            continue
        if existing:
            raise ValueError('Existing modified source preserved: ' + repo)
        url = 'https://codeload.github.com/OCA/' + repo + '/tar.gz/' + item['commit']
        with urllib.request.urlopen(url, timeout=90) as response:
            payload = response.read(100_000_001)
        if len(payload) > 100_000_000 or hashlib.sha256(payload).hexdigest() != item['archive_sha256']:
            raise ValueError('Archive integrity mismatch: ' + repo)
        files = archive_files(payload, item['modules'])
        if digest(files) != item['tree_sha256']:
            raise ValueError('Source tree integrity mismatch: ' + repo)
        for name, content in files.items():
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(content)
        print('COMMUNITY_SOURCE_INSTALLED ' + repo, flush=True)
    verified_addons_path()

if __name__ == '__main__':
    install()
