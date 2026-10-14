import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from publish_web import REQUIRED, publish, unpack


class PublishWebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def bundle(self, extra=None):
        path = self.base / 'site.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            for name in REQUIRED:
                data = b'public fixture'
                member = tarfile.TarInfo(name); member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if extra:
                archive.addfile(extra)
        return path

    def test_complete_release_publishes_exact_revision(self):
        calls = []
        publish(self.bundle(), 'a' * 40, self.base, verifier=calls.append)
        self.assertEqual(calls, ['a' * 40])
        self.assertEqual(json.loads((self.base / 'current/release.json').read_text())['revision'], 'a' * 40)
        self.assertTrue((self.base / 'current/web/index.html').is_file())

    def test_failed_health_check_restores_previous_release_and_allows_retry(self):
        publish(self.bundle(), 'a' * 40, self.base, verifier=lambda revision: None)
        previous = (self.base / 'current').resolve()
        def failed(revision): raise RuntimeError('Relay or web check failed')
        with self.assertRaisesRegex(RuntimeError, 'check failed'):
            publish(self.bundle(), 'b' * 40, self.base, verifier=failed)
        self.assertEqual((self.base / 'current').resolve(), previous)
        self.assertFalse((self.base / 'releases' / ('b' * 40)).exists())
        publish(self.bundle(), 'b' * 40, self.base, verifier=lambda revision: None)

    def test_missing_and_private_files_are_rejected(self):
        for name in ('../escape', '/absolute', '.env', 'web/.git/config', 'web/admin.html'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                unpack(self.bundle(tarfile.TarInfo(name)), self.base / 'unpacked')
        with tarfile.open(self.base / 'empty.tar.gz', 'w:gz'): pass
        with self.assertRaisesRegex(ValueError, 'Missing required'):
            unpack(self.base / 'empty.tar.gz', self.base)

    def test_links_and_devices_are_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE):
            item = tarfile.TarInfo('link'); item.type = kind; item.linkname = '/etc/passwd'
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'Unsafe'):
                unpack(self.bundle(item), self.base)
