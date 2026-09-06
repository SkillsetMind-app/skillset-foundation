"""Exercise the real backup Storage step against an isolated local API."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


class BackupStorageTest(unittest.TestCase):
    def run_backup(self, objects):
        requests = []

        class API(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                if self.path == "/storage/v1/bucket":
                    data = json.dumps([{"name": "course-content"}]).encode()
                else:
                    name = unquote(self.path.removeprefix('/storage/v1/object/course-content/'))
                    data = objects.get(name)
                    if data is None:
                        self.send_error(404)
                        return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                prefix = body['prefix'].rstrip('/')
                prefix = prefix + '/' if prefix else ''
                # Supabase lists virtual folders and actual objects separately.
                # Its UNION ALL can return both a folder and a file named foo.
                folders, files = {}, []
                for name in objects:
                    if name.startswith(prefix):
                        rest = name[len(prefix):]
                        child, _, tail = rest.partition('/')
                        if tail:
                            folders[child] = {"name": child, "id": None}
                        else:
                            files.append({"name": child, "id": "object-id"})
                entries = sorted(folders.values(), key=lambda x: x['name']) + sorted(files, key=lambda x: x['name'])
                offset, limit = body.get('offset', 0), body['limit']
                requests.append((prefix, offset))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(entries[offset:offset+limit]).encode())

        with tempfile.TemporaryDirectory(prefix='skillset-backup-test-') as work:
            server = ThreadingHTTPServer(('127.0.0.1', 0), API)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                script = (ROOT/'scripts/backup-supabase.sh').read_text(encoding='utf-8')
                storage = script.split('# --- Storage', 1)[1].split('# --- Package', 1)[0]
                storage = storage.split('\n', 1)[1]
                bash = r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else 'bash'
                env = dict(os.environ, WORK=Path(work).as_posix(), NAME='archive',
                           STAMP='2026-09-06T000000Z', DUMP_BYTES='20000',
                           DATABASE_URL='postgres://fixture@invalid.example/scratch',
                           SUPABASE_URL=f'http://127.0.0.1:{server.server_port}',
                           SUPABASE_SERVICE_ROLE_KEY='local-test-placeholder')
                compatibility = 'jq(){ command jq "$@" | tr -d "\\r"; }\npython3(){ py "$@"; }\n' if os.name == 'nt' else ''
                result = subprocess.run([bash, '-c', 'set -euo pipefail\ndie(){ exit 1; }\npg_dump(){ echo fixture-version; }\n'+compatibility+storage],
                                        cwd=ROOT, env=env, capture_output=True, text=True)
                actual = {p.relative_to(Path(work)/'archive/storage').as_posix(): p.read_bytes()
                          for p in (Path(work)/'archive/storage').rglob('*') if p.is_file()}
                manifest = Path(work) / 'archive/MANIFEST.txt'
                fields = dict(line.split(None, 1) for line in manifest.read_text().splitlines()) if manifest.exists() else {}
                return result, actual, requests, fields
            finally:
                server.shutdown()
                server.server_close()

    def test_nested_objects_spaces_and_pagination_are_restorable(self):
        objects = {"courses/c1/lesson 1.pdf": b"lesson", "users/u1/avatar.png": b"avatar"}
        objects.update({f"root-{i:04}.txt": str(i).encode() for i in range(1003)})
        result, actual, requests, manifest = self.run_backup(objects)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(actual, {'course-content/' + key: data for key, data in objects.items()},
                         'Backup omitted or changed Storage objects')
        self.assertIn(('', 1000), requests, 'Backup did not request the next Storage page')
        self.assertEqual(manifest.get('storage_layout'), 'paths-v1')

    def test_object_and_virtual_folder_with_the_same_name_are_restorable(self):
        objects = {'foo': b'root object', 'foo/bar': b'nested object',
                   'foo/bar/baz.txt': b'deeper object', 'normal.txt': b'ordinary object'}
        result, actual, _requests, manifest = self.run_backup(objects)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('4 object(s)', result.stdout)
        index = json.loads(actual.pop('INDEX.json'))
        self.assertEqual(index['format'], 'skillsetmind-storage')
        self.assertEqual(index['version'], 2)
        self.assertEqual({(item['bucket'], item['key']): actual[item['path']]
                          for item in index['objects']},
                         {('course-content', key): data for key, data in objects.items()},
                         'Indexed backup lost an object key or changed its bytes')
        self.assertEqual(set(actual), {item['path'] for item in index['objects']})
        self.assertEqual(manifest.get('storage_layout'), 'indexed-v2')


class ValidateStorageTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='skillset-storage-validate-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'objects').mkdir()
        (self.root / 'objects/00000000').write_bytes(b'root object')
        (self.root / 'objects/00000001').write_bytes(b'nested object')
        self.index = {'format': 'skillsetmind-storage', 'version': 2, 'objects': [
            {'bucket': 'course-content', 'key': 'foo', 'path': 'objects/00000000'},
            {'bucket': 'course-content', 'key': 'foo/bar', 'path': 'objects/00000001'},
        ]}

    def validate(self, index=None):
        if index is not None:
            (self.root / 'INDEX.json').write_text(json.dumps(index), encoding='utf-8')
        env = {key: value for key, value in os.environ.items() if not key.startswith('SUPABASE_')}
        return subprocess.run([os.sys.executable, str(ROOT / 'scripts/backup-storage.py'),
                               '--validate', str(self.root)], env=env, capture_output=True, text=True, timeout=10)

    def test_validates_both_layouts_without_supabase_credentials(self):
        for index in (None, self.index):
            with self.subTest(indexed=index is not None):
                result = self.validate(index)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), '2')

    def test_rejects_corrupted_or_ambiguous_index(self):
        invalid = []
        wrong_version = deepcopy(self.index)
        wrong_version['version'] = 99
        invalid.append(wrong_version)
        duplicate_key = deepcopy(self.index)
        duplicate_key['objects'][1]['key'] = 'foo'
        invalid.append(duplicate_key)
        duplicate_path = deepcopy(self.index)
        duplicate_path['objects'][1]['path'] = 'objects/00000000'
        invalid.append(duplicate_path)
        missing_file = deepcopy(self.index)
        missing_file['objects'][1]['path'] = 'objects/00000002'
        invalid.append(missing_file)
        escaped = deepcopy(self.index)
        escaped['objects'][1]['path'] = '../outside-object'
        invalid.append(escaped)
        absolute = deepcopy(self.index)
        absolute['objects'][1]['path'] = (self.root / 'objects/00000001').as_posix()
        invalid.append(absolute)
        for index in invalid:
            with self.subTest(index=index):
                self.assertNotEqual(self.validate(index).returncode, 0, 'Corrupted index was accepted')

    def test_rejects_files_missing_from_index(self):
        (self.root / 'objects/unindexed').write_bytes(b'unindexed object')
        self.assertNotEqual(self.validate(self.index).returncode, 0, 'Unindexed blob was accepted')

    def test_rejects_symlinks_in_both_layouts(self):
        link = self.root / 'objects/linked-object'
        try:
            link.symlink_to(self.root / 'objects/00000000')
        except OSError:
            self.skipTest('This OS account cannot create symbolic links')
        for index in (None, self.index):
            with self.subTest(indexed=index is not None):
                self.assertNotEqual(self.validate(index).returncode, 0, 'Symbolic link was accepted')


if __name__ == '__main__':
    unittest.main()
