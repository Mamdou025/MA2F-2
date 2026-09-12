"""Report source differences without resolving, deleting or replaying any records."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
import os
from pathlib import Path


def compare(old, new):
    if old['project'] != new['project']:
        raise ValueError('Different source projects')
    prefix = f"projects/{new['project']}/databases/(default)/documents/"

    def index(source):
        result = {}
        for document in source['documents']:
            name = document['name']
            if not name.startswith(prefix) or name in result:
                raise ValueError('Invalid or duplicate source path')
            result[name] = document
        return result

    before, after = index(old), index(new)
    # Earlier exports covered only their declared root collections, no subcollections.
    old_roots = set(old.get('counts', {})) or {p[len(prefix):].split('/')[0] for p in before}
    excluded = set(old.get('excluded', {}))

    def covered(path):
        pieces = path[len(prefix):].split('/')
        return len(pieces) == 2 and pieces[0] in old_roots and pieces[0] not in excluded

    changed = [p for p in before.keys() & after.keys() if before[p].get('fields', {}) != after[p].get('fields', {})]
    added = [p for p in after.keys() - before.keys() if covered(p)]
    extra = [p for p in after.keys() - before.keys() if not covered(p)]
    removed = list(before.keys() - after.keys())
    groups = {k: sorted(v) for k, v in {'changed': changed, 'added': added, 'absentInNewSnapshot': removed,
                                      'newlyCovered': extra}.items()}
    counts = {key: dict(sorted(Counter(p[len(prefix):].split('/')[0] for p in paths).items())) for key, paths in groups.items()}
    return {'oldReadTime': old.get('readTime'), 'newReadTime': new.get('readTime'), 'paths': groups,
            'countsByRootCollection': counts, 'writesPerformed': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--old', required=True)
    parser.add_argument('--new', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    old_bytes, new_bytes = Path(args.old).read_bytes(), Path(args.new).read_bytes()
    result = compare(json.loads(gzip.decompress(old_bytes)), json.loads(gzip.decompress(new_bytes)))
    result.update(oldSha256=hashlib.sha256(old_bytes).hexdigest(), newSha256=hashlib.sha256(new_bytes).hexdigest())
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps({'countsByRootCollection': result['countsByRootCollection'], 'writesPerformed': False}))


if __name__ == '__main__':
    main()
