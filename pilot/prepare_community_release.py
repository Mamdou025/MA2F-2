"""Create a verified deployment archive lock from the already-tested OCA commits."""
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('community_sources', ROOT/'deployment/odoo-core/community_sources.py')
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)
tested = json.loads((ROOT/'pilot/community-addons.lock.json').read_text())

def prepare(pair):
    repo, item = pair
    with urllib.request.urlopen('https://codeload.github.com/OCA/'+repo+'/tar.gz/'+item['commit'], timeout=90) as response:
        payload = response.read()
    files = sources.archive_files(payload, item['modules'])
    return repo, dict(item, archive_sha256=hashlib.sha256(payload).hexdigest(), tree_sha256=sources.digest(files))

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    release = dict(pool.map(prepare, tested.items()))
(ROOT/'deployment/odoo-core/community-release.json').write_text(json.dumps(release, indent=2)+'\n')
print('COMMUNITY_RELEASE_LOCK_CREATED', len(release))
