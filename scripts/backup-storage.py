"""Download every Storage object, preserving its path, without logging credentials."""
import json
import os
from pathlib import Path
import shutil
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen


def backup_storage(destination):
    root = Path(destination).resolve()
    base = os.environ['SUPABASE_URL'].rstrip('/') + '/storage/v1'
    headers = {'Authorization': 'Bearer ' + os.environ['SUPABASE_SERVICE_ROLE_KEY'],
               'Content-Type': 'application/json', 'User-Agent': 'SkillsetMind-backup/1.0'}

    def request(path, body=None):
        return urlopen(Request(base + path, headers=headers,
                              data=None if body is None else json.dumps(body).encode()), timeout=60)

    def component(value):
        if not isinstance(value, str) or value in ('', '.', '..') or any(c in value for c in '/\\\x00'):
            raise ValueError('Invalid Storage path')
        return value

    with request('/bucket') as response:
        buckets = json.load(response)
    count = 0
    for bucket in buckets:
        name = component(bucket['name'])
        prefixes = ['']
        while prefixes:
            prefix = prefixes.pop()
            offset = 0
            while True:
                with request('/object/list/' + quote(name, safe=''), {
                    'prefix': prefix, 'limit': 1000, 'offset': offset,
                    'sortBy': {'column': 'name', 'order': 'asc'},
                }) as response:
                    entries = json.load(response)
                if not isinstance(entries, list):
                    raise ValueError('Invalid Storage listing')
                for entry in entries:
                    child = component(entry['name'])
                    path = prefix + child
                    if entry.get('id') is None:
                        prefixes.append(path + '/')
                        continue
                    target = (root / name / path).resolve()
                    if not target.is_relative_to(root):
                        raise ValueError('Storage path escapes backup')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with request('/object/' + quote(name, safe='') + '/' + quote(path, safe='/')) as response:
                        with target.open('wb') as output:
                            shutil.copyfileobj(response, output, 1024 * 1024)
                    count += 1
                if len(entries) < 1000:
                    break
                offset += len(entries)
    return count


if __name__ == '__main__':
    try:
        print(backup_storage(sys.argv[1]))
    except Exception as error:
        # Paths can include personal data; HTTP errors can contain URLs/headers.
        print('Storage backup failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
