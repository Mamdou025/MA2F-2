"""Export the verified fictional pilot backup to its dedicated Replit bucket."""
from pathlib import Path
import hashlib
import json
import tarfile
import uuid
from replit.object_storage import Client

ROOT = Path(__file__).resolve().parent
N = ROOT / '.local/native'
B = N / 'backups/806f64067bcc'
BUCKET = 'replit-objstore-f0467e02-6ff7-4a22-b988-316017beff35'
checks = json.loads((B / 'checksums.json').read_text())
result = json.loads((B / 'result.json').read_text())
assert result['status'] == 'passed'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

assert digest(B / 'database.dump') == checks['database']
files = [B / x for x in ['database.dump', 'manifest.json', 'checksums.json', 'result.json']]
files += sorted((B / 'filestore').rglob('*'))
files = [f for f in files if f.is_file()]
assert not any(f.is_symlink() for f in files)
actual = {str(f.relative_to(B / 'filestore')): digest(f) for f in (B / 'filestore').rglob('*') if f.is_file()}
assert actual == checks['filestore']
pack = N / 'backups' / ('storage-package-' + uuid.uuid4().hex + '.tar.gz')
with tarfile.open(pack, 'w:gz') as archive:
    for f in files:
        archive.add(f, arcname=str(f.relative_to(B)), recursive=False)
pack.chmod(0o600)
sha = digest(pack)
key = 'ma2f-pilot/806f64067bcc/' + sha + '.tar.gz'
client = Client(bucket_id=BUCKET)
if client.exists(key):
    assert hashlib.sha256(client.download_as_bytes(key)).hexdigest() == sha
else:
    client.upload_from_filename(key, str(pack))
dest = N / 'storage-downloads' / uuid.uuid4().hex
dest.mkdir(parents=True, mode=0o700)
received = dest / 'backup.tar.gz'
client.download_to_filename(key, str(received))
received.chmod(0o600)
assert digest(received) == sha
with tarfile.open(received, 'r:gz') as archive:
    members = archive.getmembers()
    expected = {str(f.relative_to(B)) for f in files}
    assert {m.name for m in members} == expected and all(m.isfile() for m in members)
    archive.extractall(dest / 'unpacked', filter='data')
unpacked = dest / 'unpacked'
assert all(digest(unpacked / f.relative_to(B)) == digest(f) for f in files)
receipt = {'status': 'uploaded_and_download_verified', 'bucketId': BUCKET, 'object': key,
           'archiveSha256': sha, 'bytes': pack.stat().st_size, 'verifiedFiles': len(files),
           'downloadDirectory': str(dest), 'databaseSha256': checks['database'],
           'scope': 'fictitious pilot backup outside workspace; no production database or redeploy acceptance'}
client.upload_from_text(key + '.verified.json', json.dumps(receipt, indent=2))
assert json.loads(client.download_as_text(key + '.verified.json')) == receipt
(N / 'object-storage-backup-result.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt))
