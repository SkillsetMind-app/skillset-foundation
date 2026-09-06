"""Exercise the real backup Storage step against an isolated local API."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


class BackupStorageTest(unittest.TestCase):
    def test_nested_objects_spaces_and_pagination_are_restorable(self):
        objects = {"courses/c1/lesson 1.pdf": b"lesson", "users/u1/avatar.png": b"avatar"}
        objects.update({f"root-{i:04}.txt": str(i).encode() for i in range(1003)})
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
                entries = {}
                for name in objects:
                    if name.startswith(prefix):
                        rest = name[len(prefix):]
                        child, _, tail = rest.partition('/')
                        entries[child] = {"name": child, "id": None if tail else "object-id"}
                offset, limit = body.get('offset', 0), body['limit']
                requests.append((prefix, offset))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(sorted(entries.values(), key=lambda x: x['name'])[offset:offset+limit]).encode())

        with tempfile.TemporaryDirectory(prefix='skillset-backup-test-') as work:
            server = ThreadingHTTPServer(('127.0.0.1', 0), API)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                script = (ROOT/'scripts/backup-supabase.sh').read_text(encoding='utf-8')
                storage = script.split('# --- Storage', 1)[1].split('# --- Manifest', 1)[0]
                storage = storage.split('\n', 1)[1]
                bash = r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else 'bash'
                env = dict(os.environ, WORK=Path(work).as_posix(), NAME='archive',
                           SUPABASE_URL=f'http://127.0.0.1:{server.server_port}',
                           SUPABASE_SERVICE_ROLE_KEY='local-test-placeholder')
                compatibility = 'jq(){ command jq "$@" | tr -d "\\r"; }\npython3(){ py "$@"; }\n' if os.name == 'nt' else ''
                result = subprocess.run([bash, '-c', 'set -euo pipefail\ndie(){ exit 1; }\n'+compatibility+storage],
                                        cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                actual = {p.relative_to(Path(work)/'archive/storage/course-content').as_posix():p.read_bytes()
                          for p in (Path(work)/'archive/storage/course-content').rglob('*') if p.is_file()}
                self.assertEqual(actual, objects, 'Backup omitted or changed Storage objects')
                self.assertIn(('', 1000), requests, 'Backup did not request the next Storage page')
            finally:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
