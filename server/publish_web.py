#!/usr/bin/env python3
"""Restricted SSH receiver: publish one static artifact, without shell access."""
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import ssl
import sys
import tarfile
import tempfile
import time

BASE = Path('/var/www/tinyfrens')
MAX_BYTES = 256 * 1024 * 1024
REQUIRED = ('index.html', 'web/index.html', 'web/gallery.html', '.well-known/farcaster.json',
            'snap-v2.json', 'import/skill.md', 'web/sw.js', 'docs/index.html')


def unpack(archive, destination):
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        if len(members) > 20000 or sum(item.size for item in members) > 1024 * 1024 * 1024:
            raise ValueError('Artifact exceeds deployment limits')
        for item in members:
            path = PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
                raise ValueError('Unsafe archive entry')
            if any(part.startswith('.') and part not in ('.well-known', '.nojekyll') for part in path.parts):
                raise ValueError('Private file in artifact')
            if path.as_posix() in ('admin.html', 'web/admin.html') or path.parts[:1] == ('admin',):
                raise ValueError('Admin must not be published')
        bundle.extractall(destination, members=members, filter='data')
    for name in REQUIRED:
        if not (destination / name).is_file():
            raise ValueError(f'Missing required public file: {name}')
    for item in destination.rglob('*'):
        item.chmod(0o755 if item.is_dir() else 0o644)
    destination.chmod(0o755)


class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = self._context.wrap_socket(socket.create_connection(('127.0.0.1', 443), 20), server_hostname=self.host)


def verify(revision):
    for host in ('tinyfrens.lol', 'www.tinyfrens.lol'):
        for path, accept in [('/release.json', 'application/json'), ('/', 'text/html'),
                             ('/web/', 'text/html'), ('/snap', 'application/vnd.farcaster.snap+json')]:
            connection = LocalTLS(host, timeout=20, context=ssl.create_default_context())
            connection.request('GET', path, headers={'Accept':accept})
            response = connection.getresponse(); data = response.read(); connection.close()
            if response.status != 200:
                raise RuntimeError(f'{host}{path}: HTTP {response.status}')
            if path == '/release.json' and json.loads(data).get('revision') != revision:
                raise RuntimeError('Published revision does not match artifact')


def publish(archive, revision, base=BASE, verifier=verify):
    releases = base / 'releases'; releases.mkdir(parents=True, exist_ok=True)
    target = releases / revision
    with tempfile.TemporaryDirectory(dir=releases, prefix='incoming-') as directory:
        stage = Path(directory) / 'site'; stage.mkdir()
        unpack(archive, stage)
        (stage / 'release.json').write_text(json.dumps({'revision':revision, 'publishedAt':int(time.time())}) + '\n')
        if target.exists():
            raise ValueError('Revision already published; refuse to overwrite an immutable release')
        stage.rename(target)
    current = base / 'current'
    previous = current.resolve() if current.is_symlink() else None
    candidate = base / 'current.next'; candidate.unlink(missing_ok=True); candidate.symlink_to(target)
    candidate.replace(current)
    try:
        verifier(revision)
    except Exception:
        if previous:
            candidate.symlink_to(previous); candidate.replace(current)
        else:
            current.unlink()
        shutil.rmtree(target)
        raise
    print(f'Published {revision}', flush=True)


def main():
    import fcntl
    command = re.fullmatch(r'publish ([a-f0-9]{40})', os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if not command:
        raise ValueError('Only publish <commit SHA> is permitted')
    with (BASE / '.publish.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        revision = command[1]
        if (BASE / 'current' / 'release.json').is_file():
            if json.loads((BASE / 'current' / 'release.json').read_text()).get('revision') == revision:
                verify(revision)
                print(f'Already published {revision}')
                return
        with tempfile.NamedTemporaryFile(dir=BASE, suffix='.tar.gz') as archive:
            total = 0
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError('Compressed artifact too large')
                archive.write(chunk)
            archive.flush()
            publish(archive.name, revision)


if __name__ == '__main__':
    main()
