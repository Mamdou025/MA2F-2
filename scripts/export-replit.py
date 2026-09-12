"""Package the current MA2F source (including pending edits), excluding runtime data."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
directories = {'client', 'server', 'shared', 'patches', 'pilot', 'docs', 'deployment',
               'scripts', 'tests', 'functions', 'cloud-functions', 'public', 'attached_assets'}
root_files = {'.replit', '.gitignore', 'replit.md', 'CLAUDE.md', 'package.json', 'pnpm-lock.yaml',
              'tsconfig.json', 'vite.config.ts', 'vite.replit.config.ts', 'components.json',
              'firebase.json', 'firestore.rules', 'storage.rules', 'vercel.json'}
suffixes = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.py', '.ps1',
            '.md', '.txt', '.xml', '.csv', '.html', '.css', '.svg', '.png', '.jpg', '.jpeg',
            '.webp', '.ico', '.woff', '.woff2', '.ttf', '.patch', '.rules', '.toml', '.conf', '.replit', '.nix', '.sh'}
listed = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root)
files = []
for name in sorted(set(listed.decode('utf-8').split('\0')) - {''}):
    relative = Path(name)
    if any(part in {'.local', 'node_modules', '__pycache__', '.git', 'dist'} for part in relative.parts):
        continue
    if relative.name.startswith('.env') and relative.name != '.env.example':
        continue
    if relative.as_posix() not in root_files:
        if relative.parts[0] not in directories:
            continue
        if relative.suffix not in suffixes and relative.name != '.env.example':
            continue
    path = root / relative
    if path.is_file() and not path.is_symlink():
        files.append((relative.as_posix(), path.read_bytes()))
required = {'package.json', 'pnpm-lock.yaml', '.replit', 'vite.replit.config.ts',
            'pilot/addons/ma2f_pilot_commands/models/production_command.py'}
assert required <= {name for name, _ in files}
directory = root / 'pilot/.local/transfer'
directory.mkdir(parents=True, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
archive = directory / ('MA2F-new-version-replit-' + stamp + '.zip')
manifest = {'source': 'current local working tree including uncommitted edits',
            'created_utc': stamp, 'scope': 'source only; no users, passwords, database dumps or pilot runtime',
            'files': {name: hashlib.sha256(data).hexdigest() for name, data in files}}
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as bundle:
    for name, data in files:
        bundle.writestr(name, data)
    bundle.writestr('TRANSFER-MANIFEST.json', json.dumps(manifest, indent=2))
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert not any('/.local/' in name or '/node_modules/' in name for name in bundle.namelist())
print(json.dumps({'archive': str(archive), 'source_files': len(files), 'bytes': archive.stat().st_size}))
