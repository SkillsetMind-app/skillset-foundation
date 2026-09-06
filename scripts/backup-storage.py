"""Back up Storage keys losslessly and validate exports without credentials."""
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen


def component(value):
    if not isinstance(value, str) or value in ('', '.', '..') or any(c in value for c in '/\\\x00'):
        raise ValueError('Invalid Storage path')
    return value


def validate_storage(destination, expected_layout=None):
    if expected_layout not in (None, '', 'paths-v1', 'indexed-v2'):
        raise ValueError('Unknown Storage layout')
    root = Path(destination)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Invalid Storage directory')
    root = root.resolve()
    files = set()
    for path in root.rglob('*'):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('Invalid Storage filesystem path')
        if path.is_file():
            files.add(path.relative_to(root).as_posix())
        elif not path.is_dir():
            raise ValueError('Invalid Storage filesystem entry')
    indexed = 'INDEX.json' in files
    if ((expected_layout == 'indexed-v2' and not indexed)
            or (expected_layout == 'paths-v1' and indexed)):
        raise ValueError('Storage layout does not match manifest')
    if not indexed:
        return len(files)
    with (root / 'INDEX.json').open(encoding='utf-8') as source:
        index = json.load(source)
    if (not isinstance(index, dict) or index.get('format') != 'skillsetmind-storage'
            or index.get('version') != 2 or not isinstance(index.get('objects'), list)):
        raise ValueError('Invalid Storage index')
    keys, paths = set(), set()
    for entry in index['objects']:
        if not isinstance(entry, dict) or set(entry) != {'bucket', 'key', 'path'}:
            raise ValueError('Invalid Storage index entry')
        bucket = component(entry['bucket'])
        key, path = entry['key'], entry['path']
        if (not isinstance(key, str) or not key or '\x00' in key
                or not isinstance(path, str) or not re.fullmatch(r'objects/[0-9]{8,}', path)):
            raise ValueError('Invalid indexed Storage path')
        if (bucket, key) in keys or path in paths:
            raise ValueError('Duplicate indexed Storage object')
        keys.add((bucket, key))
        paths.add(path)
    if files != paths | {'INDEX.json'}:
        raise ValueError('Storage index does not match its blobs')
    return len(keys)


def backup_storage(destination):
    root = Path(destination).resolve()
    base = os.environ['SUPABASE_URL'].rstrip('/') + '/storage/v1'
    headers = {'Authorization': 'Bearer ' + os.environ['SUPABASE_SERVICE_ROLE_KEY'],
               'Content-Type': 'application/json', 'User-Agent': 'SkillsetMind-backup/1.0'}

    def request(path, body=None):
        return urlopen(Request(base + path, headers=headers,
                              data=None if body is None else json.dumps(body).encode()), timeout=60)

    with request('/bucket') as response:
        buckets = json.load(response)
    objects = []
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
                    objects.append((name, path))
                if len(entries) < 1000:
                    break
                offset += len(entries)
    if len(set(objects)) != len(objects):
        raise ValueError('Duplicate Storage listing')
    # Storage keys form a flat namespace: foo and foo/bar can both be objects.
    # Keep legacy paths unless they collide with another file or its directory.
    relative_paths = [Path(bucket) / key for bucket, key in objects]
    file_paths = {os.path.normcase(str(path)) for path in relative_paths}
    directory_paths = {os.path.normcase(str(parent)) for path in relative_paths for parent in path.parents}
    indexed = bool(file_paths & directory_paths) or len(file_paths) != len(relative_paths)
    index = {'format': 'skillsetmind-storage', 'version': 2, 'objects': []}
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise ValueError('Storage backup destination must be empty')
    for number, (bucket, key) in enumerate(objects):
        relative = f'objects/{number:08d}' if indexed else relative_paths[number].as_posix()
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError('Storage path escapes backup')
        target.parent.mkdir(parents=True, exist_ok=True)
        with request('/object/' + quote(bucket, safe='') + '/' + quote(key, safe='/')) as response:
            with target.open('xb') as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
        if indexed:
            index['objects'].append({'bucket': bucket, 'key': key, 'path': relative})
    if indexed:
        with (root / 'INDEX.json').open('x', encoding='utf-8') as output:
            json.dump(index, output, ensure_ascii=True)
    return validate_storage(root, 'indexed-v2' if indexed else 'paths-v1')


if __name__ == '__main__':
    try:
        if len(sys.argv) in (3, 4) and sys.argv[1] == '--validate':
            print(validate_storage(sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None))
        elif len(sys.argv) == 2:
            print(backup_storage(sys.argv[1]))
        else:
            raise ValueError('Invalid Storage operation arguments')
    except Exception as error:
        # Paths can include personal data; HTTP errors can contain URLs/headers.
        print('Storage operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
