"""Exercise the actual privileged workflow shell with mocked GitHub API responses."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/safe-automerge.yml'


class OwnerAutoMergeTests(unittest.TestCase):
    def run_policy(self, **changes):
        bash = shutil.which('bash')
        if os.name == 'nt':
            git_bash = Path(os.environ['ProgramFiles']) / 'Git/bin/bash.exe'
            if git_bash.is_file():
                bash = str(git_bash)
        self.assertTrue(bash and shutil.which('jq'), 'bash and jq are required')
        script = WORKFLOW.read_text().split('        run: |\n', 1)[1]
        script = '\n'.join(line[10:] for line in script.splitlines())
        pr = {'state': 'open', 'user': {'login': 'dutchiono'},
              'head': {'repo': {'full_name': 'dutchiono/TinyFrens'}, 'sha': 'current-head'},
              'base': {'ref': 'main'}, 'draft': False, 'labels': [], 'auto_merge': None}
        pr.update(changes)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            merged = dict(pr, state='closed', merged=True)
            (root / 'response.json').write_text(json.dumps(pr))
            (root / 'merged.json').write_text(json.dumps(merged))
            (root / 'mock.py').write_text('''import json, os, sys
from pathlib import Path
root = Path(os.environ['MOCK_ROOT'])
with (root/'calls.jsonl').open('a') as log: log.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[1:] == ['api', 'repos/dutchiono/TinyFrens/pulls/42']:
    count_file = root/'api-count'
    count = int(count_file.read_text()) if count_file.exists() else 0
    count_file.write_text(str(count + 1))
    print((root/('response.json' if count == 0 else 'merged.json')).read_text())
elif sys.argv[1:3] == ['pr', 'merge']:
    pass
elif sys.argv[1:] in (
    ['workflow', 'run', 'publish-server.yml', '--repo', 'dutchiono/TinyFrens', '--ref', 'main'],
    ['workflow', 'run', 'deploy-backend.yml', '--repo', 'dutchiono/TinyFrens', '--ref', 'main'],
):
    pass
else:
    raise SystemExit('Unexpected GitHub operation')
''')
            (root / 'gh').write_text('#!/usr/bin/env bash\npython "$MOCK_ROOT/mock.py" "$@"\n')
            (root / 'gh').chmod(0o755)
            env = dict(os.environ, MOCK_ROOT=str(root), REPO='dutchiono/TinyFrens', PR='42',
                       PATH=str(root) + os.pathsep + os.environ['PATH'])
            result = subprocess.run([bash, '-c', script], env=env, cwd=root,
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return [json.loads(line) for line in (root/'calls.jsonl').read_text().splitlines()]

    def test_owner_requests_squash_auto_merge_for_current_head(self):
        calls = self.run_policy()
        self.assertEqual(calls[1], ['pr', 'merge', '42', '--repo', 'dutchiono/TinyFrens',
                                  '--squash', '--auto', '--match-head-commit', 'current-head'])
        self.assertEqual(calls[-2], ['workflow', 'run', 'publish-server.yml', '--repo',
                                    'dutchiono/TinyFrens', '--ref', 'main'])
        self.assertEqual(calls[-1], ['workflow', 'run', 'deploy-backend.yml', '--repo',
                                    'dutchiono/TinyFrens', '--ref', 'main'])
        self.assertEqual(len(calls), 5)

    def test_other_author_is_not_merged(self):
        self.assertEqual(len(self.run_policy(user={'login': 'someone-else'})), 1)

    def test_fork_is_not_merged(self):
        self.assertEqual(len(self.run_policy(head={'repo': {'full_name': 'other/fork'}})), 1)

    def test_closed_pr_is_not_merged(self):
        self.assertEqual(len(self.run_policy(state='closed')), 1)

    def test_other_base_is_not_merged(self):
        self.assertEqual(len(self.run_policy(base={'ref': 'release'})), 1)

    def test_draft_without_auto_merge_is_left_alone(self):
        self.assertEqual(len(self.run_policy(draft=True)), 1)

    def test_draft_disables_existing_auto_merge(self):
        self.assertEqual(self.run_policy(draft=True, auto_merge={})[1][-1], '--disable-auto')

    def test_hold_label_disables_existing_auto_merge(self):
        self.assertEqual(self.run_policy(labels=[{'name': 'hold-merge'}], auto_merge={})[1][-1],
                         '--disable-auto')


if __name__ == '__main__':
    unittest.main()
