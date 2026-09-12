import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import community_sources as sources

def archive(name, data=b'x', kind=None):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as tar:
        member = tarfile.TarInfo(name)
        member.size = len(data)
        if kind: member.type = kind
        tar.addfile(member, io.BytesIO(data))
    return out.getvalue()

class SourceIntegrityTests(unittest.TestCase):
    def test_traversal_and_symlinks_rejected(self):
        for name, kind in [('root/mod/../../escape', None), ('/root/mod/file', None), ('root/mod/link', tarfile.SYMTYPE)]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                sources.archive_files(archive(name, kind=kind), ['mod'])

    def test_selected_module_required(self):
        with self.assertRaises(ValueError):
            sources.archive_files(archive('root/other/__manifest__.py'), ['mod'])
        files = sources.archive_files(archive('root/mod/__manifest__.py'), ['mod'])
        self.assertEqual(files, {'mod/__manifest__.py': b'x'})

    def test_runtime_detects_modified_and_extra_source(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(sources, 'ROOT', Path(folder)):
            destination = Path(folder)/'.local/community-addons/mod'
            destination.mkdir(parents=True)
            source = destination/'__manifest__.py'
            source.write_bytes(b'original')
            release = {'repo': {'modules': ['mod'], 'tree_sha256': sources.digest({'mod/__manifest__.py': b'original'})}}
            (Path(folder)/'community-release.json').write_text(json.dumps(release))
            self.assertEqual(sources.verified_addons_path(), str(destination.parent))
            source.write_bytes(b'modified')
            with self.assertRaises(ValueError): sources.verified_addons_path()
            source.write_bytes(b'original')
            (destination/'extra.py').write_text('unexpected')
            with self.assertRaises(ValueError): sources.verified_addons_path()

if __name__ == '__main__': unittest.main()
