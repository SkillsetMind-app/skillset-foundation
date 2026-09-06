"""Run the real restore scripts using only temporary fixtures and local command doubles."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASH = r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else 'bash'
FILES = {
    'course-content/courses/c1/lesson 1.pdf': b'lesson fixture',
    'public-media/users/u1/avatar.png': b'image fixture',
}

# Only the external boundaries are replaced: decryption, R2, Postgres and rsync.
# The scripts still parse the real manifest, unpack a real tar and count/copy
# actual files. All mutations are confined to this test's TemporaryDirectory.
HARNESS = r'''
set -Eeuo pipefail
TEST_WORK="$(cd "$TEST_WORK" && pwd -P)"
export TMPDIR="$TEST_WORK/temp"
export AGE_KEY_FILE="$TEST_WORK/test-key"
export ENV_FILE="$TEST_WORK/dr.env"
export DR_DIR="$TEST_WORK/dr"
TRACE="$TEST_WORK/commands"
safe_path() {
  local candidate="$1" resolved
  if command -v cygpath >/dev/null 2>&1; then candidate="$(cygpath -u "$candidate")"; fi
  resolved="$(realpath -m -- "$candidate")"
  [[ "$resolved" == "$TEST_WORK" || "$resolved" == "$TEST_WORK/"* ]] || {
    echo 'TEST-BLOCKED: path outside temporary fixture' >&2; return 97;
  }
}
mkdir() {
  local arg
  for arg in "$@"; do
    [[ "$arg" == -* ]] && continue
    # Let the original drill reach the mocked rsync for the RED regression,
    # without creating its hard-coded system directory.
    [[ "$arg" == /var/lib/skillsetmind-dr* ]] && return 0
    safe_path "$arg" || return
  done
  command mkdir "$@"
}
rm() {
  local arg
  for arg in "$@"; do
    [[ "$arg" == -* ]] && continue
    safe_path "$arg" || return
  done
  command rm "$@"
}
age() {
  local output=''
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == -o ]]; then output="$2"; shift; fi
    shift
  done
  safe_path "$output"
  command cp "$TEST_ARCHIVE" "$output"
}
rclone() {
  case "$1" in
    lsf) printf '%s\n' "${TEST_ARCHIVE##*/}" ;;
    copy)
      safe_path "$3"
      command cp "$TEST_ARCHIVE" "$3/${TEST_ARCHIVE##*/}"
      ;;
    *) return 97 ;;
  esac
}
psql() {
  printf 'PSQL\n' >> "$TRACE"
  if [[ " $* " == *' -f '* && "${TEST_RESTORE_FAIL:-0}" == 1 ]]; then
    printf 'SYNTHETIC_COPY_STDOUT_ROW\n'
    printf 'ERROR: synthetic COPY failed: SYNTHETIC_COPY_STDERR_ROW\n' >&2
    return 3
  fi
  case "$*" in
    *'information_schema.tables'*) printf '25\n' ;;
    *'auth.users'*) printf '1\n' ;;
    *'storage.objects'*)
      printf 'DB_STORAGE\n' >> "$TRACE"
      [[ "${TEST_DB_QUERY_FAIL:-0}" == 0 ]] || return 1
      printf '%s\n' "${TEST_DB_STORAGE_COUNT:-2}"
      ;;
  esac
}
sudo() {
  [[ "$1" == -u && "$2" == postgres && "$3" == psql ]] || return 97
  shift 3
  psql "$@"
}
rsync() {
  printf 'RSYNC\n' >> "$TRACE"
  local source="${@: -2:1}" destination="${@: -1}"
  safe_path "$source"
  safe_path "$destination" || return
  command cp -a "$source/." "$destination/"
}
source "$@"
'''


class RestoreBackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='skillset-restore-test-')
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        (self.work / 'temp').mkdir()
        (self.work / 'test-key').write_text('test-only placeholder', encoding='utf-8')
        (self.work / 'dr.env').write_text(
            'R2_ACCESS_KEY_ID=test-only\nR2_SECRET_ACCESS_KEY=test-only\n'
            'R2_ENDPOINT=https://invalid.example\nR2_BUCKET=test-only\n'
            'PGDATABASE_DR=test_only_dr\n', encoding='utf-8')
        self.sequence = 0

    def archive(self, files=None, manifest_count='2'):
        files = FILES if files is None else files
        self.sequence += 1
        directory = self.work / f'fixture-{self.sequence}'
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H%M%SZ')
        name = f'skillsetmind-{stamp}'
        package = directory / name
        (package / 'storage').mkdir(parents=True)
        for key, content in files.items():
            destination = package / 'storage' / key
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        manifest = f'created_utc {stamp}\n'
        if manifest_count is not None:
            manifest += f'storage_objects {manifest_count}\n'
        (package / 'MANIFEST.txt').write_text(manifest, encoding='utf-8')
        (package / 'database.sql').write_text('CREATE TABLE fixture(id int);\n', encoding='utf-8')
        archive = directory / f'{name}.tar.gz.age'
        with tarfile.open(archive, 'w:gz') as output:
            output.add(package, arcname=name)
        return archive

    def run_script(self, name, archive, *arguments, db_count='2', query_fail=False, restore_fail=False):
        env = dict(os.environ, TEST_WORK=self.work.as_posix(),
                   TEST_ARCHIVE=archive.as_posix(), TEST_DB_STORAGE_COUNT=db_count,
                   TEST_DB_QUERY_FAIL='1' if query_fail else '0',
                   TEST_RESTORE_FAIL='1' if restore_fail else '0',
                   PROTECTED_PROJECT_REF='')
        args = [archive.as_posix(), *arguments] if name == 'restore-backup.sh' else []
        result = subprocess.run(
            [BASH, '-c', HARNESS, 'restore-fixture', (ROOT / 'scripts' / name).as_posix(), *args],
            input=b'RESTORE\n', capture_output=True, env=env, timeout=25, cwd=self.work)
        result.stdout = result.stdout.decode('utf-8', errors='replace')
        result.stderr = result.stderr.decode('utf-8', errors='replace')
        self.assertEqual(list((self.work / 'temp').iterdir()), [], 'temporary plaintext was not cleaned')
        return result

    def commands(self):
        trace = self.work / 'commands'
        return trace.read_text(encoding='utf-8').splitlines() if trace.exists() else []

    def seed_standby(self):
        existing = self.work / 'dr' / 'storage' / 'previous-good-file'
        existing.parent.mkdir(parents=True)
        existing.write_bytes(b'previous verified backup')
        return existing

    def assert_rejected_before_sync(self, result, previous):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('RSYNC', self.commands(), 'incomplete backup reached destructive rsync')
        self.assertEqual(previous.read_bytes(), b'previous verified backup')
        self.assertFalse((self.work / 'dr' / 'last-drill.json').exists())

    def test_inspection_does_not_restore_or_export_files(self):
        result = self.run_script('restore-backup.sh', self.archive())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Inspect-only', result.stdout)
        self.assertNotIn('PSQL', self.commands())
        self.assertFalse((self.work / 'export').exists())

    def test_inspection_rejects_manifest_file_count_mismatch(self):
        result = self.run_script('restore-backup.sh', self.archive(manifest_count='3'))
        self.assertNotEqual(result.returncode, 0, 'incomplete archive was accepted')
        self.assertNotIn('PSQL', self.commands())

    def test_inspection_requires_one_valid_manifest_count(self):
        for count in (None, 'invalid', '2\nstorage_objects 2'):
            with self.subTest(count=count):
                result = self.run_script('restore-backup.sh', self.archive(manifest_count=count))
                self.assertNotEqual(result.returncode, 0, 'unverifiable manifest was accepted')

    def test_database_restore_requires_explicit_storage_destination(self):
        result = self.run_script('restore-backup.sh', self.archive(), '--target', 'postgres://scratch')
        self.assertNotEqual(result.returncode, 0, 'restore silently discarded the storage export')
        self.assertNotIn('PSQL', self.commands())

    def test_restore_preserves_nested_blobs_after_cleanup(self):
        destination = self.work / 'export with spaces'
        result = self.run_script('restore-backup.sh', self.archive(), '--target', 'postgres://scratch',
                                 '--storage-out', destination.as_posix())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PSQL', self.commands())
        self.assertEqual({file.relative_to(destination).as_posix(): file.read_bytes()
                          for file in destination.rglob('*') if file.is_file()}, FILES)

    def test_restore_does_not_overwrite_existing_destination(self):
        destination = self.work / 'export'
        destination.mkdir()
        marker = destination / 'keep'
        marker.write_bytes(b'keep')
        result = self.run_script('restore-backup.sh', self.archive(), '--target', 'postgres://scratch',
                                 '--storage-out', destination.as_posix())
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(marker.read_bytes(), b'keep')
        self.assertNotIn('PSQL', self.commands())

    def test_restore_failure_does_not_publish_dump_contents(self):
        destination = self.work / 'export'
        result = self.run_script('restore-backup.sh', self.archive(), '--target', 'postgres://scratch',
                                 '--storage-out', destination.as_posix(), restore_fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('SYNTHETIC_COPY_STDOUT_ROW', result.stdout + result.stderr)
        self.assertNotIn('SYNTHETIC_COPY_STDERR_ROW', result.stdout + result.stderr)
        self.assertNotIn('database restored', result.stdout)
        self.assertEqual({file.relative_to(destination).as_posix(): file.read_bytes()
                          for file in destination.rglob('*') if file.is_file()}, FILES)

    def test_drill_restore_failure_does_not_relay_dump_contents_to_logs(self):
        previous = self.seed_standby()
        result = self.run_script('vps-restore-drill.sh', self.archive(), restore_fail=True)
        self.assert_rejected_before_sync(result, previous)
        self.assertNotIn('SYNTHETIC_COPY_STDOUT_ROW', result.stdout + result.stderr)
        self.assertNotIn('SYNTHETIC_COPY_STDERR_ROW', result.stdout + result.stderr)

    def test_drill_rejects_manifest_mismatch_before_database_restore(self):
        previous = self.seed_standby()
        result = self.run_script('vps-restore-drill.sh', self.archive(manifest_count='3'))
        self.assertNotIn('PSQL', self.commands(), 'bad manifest reached database restore')
        self.assert_rejected_before_sync(result, previous)

    def test_drill_rejects_empty_files_when_restored_database_has_objects(self):
        previous = self.seed_standby()
        result = self.run_script('vps-restore-drill.sh', self.archive(files={}, manifest_count='0'), db_count='3')
        self.assert_rejected_before_sync(result, previous)

    def test_drill_rejects_extra_files_not_present_in_database(self):
        previous = self.seed_standby()
        result = self.run_script('vps-restore-drill.sh', self.archive(), db_count='1')
        self.assert_rejected_before_sync(result, previous)

    def test_drill_does_not_sync_when_database_count_query_fails(self):
        previous = self.seed_standby()
        result = self.run_script('vps-restore-drill.sh', self.archive(), query_fail=True)
        self.assert_rejected_before_sync(result, previous)

    def test_drill_syncs_after_manifest_files_and_database_agree(self):
        result = self.run_script('vps-restore-drill.sh', self.archive())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        commands = self.commands()
        self.assertLess(commands.index('DB_STORAGE'), commands.index('RSYNC'))
        destination = self.work / 'dr' / 'storage'
        self.assertEqual({file.relative_to(destination).as_posix(): file.read_bytes()
                          for file in destination.rglob('*') if file.is_file()}, FILES)
        status = json.loads((self.work / 'dr' / 'last-drill.json').read_text(encoding='utf-8'))
        self.assertIs(status['ok'], True)
        self.assertEqual(status['files'], 2)

    def test_drill_accepts_zero_files_only_when_database_agrees(self):
        result = self.run_script('vps-restore-drill.sh', self.archive(files={}, manifest_count='0'), db_count='0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertLess(self.commands().index('DB_STORAGE'), self.commands().index('RSYNC'))


if __name__ == '__main__':
    unittest.main()
