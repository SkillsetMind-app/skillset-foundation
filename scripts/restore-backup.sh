#!/usr/bin/env bash
# Restores an encrypted backup produced by scripts/backup-supabase.sh.
#
# Default mode is inspect-only: decrypt, unpack, report what's inside, restore
# NOTHING. That is the mode you run monthly to prove the backups are real.
# Writing to a database requires --target with an explicit URL and a new
# --storage-out directory, which survives cleanup for a separate Storage upload.
#
#   ./scripts/restore-backup.sh backup.tar.gz.age                  # inspect
#   ./scripts/restore-backup.sh backup.tar.gz.age --target "$URL" --storage-out ./restored-storage
#
# AGE_KEY_FILE must point at the age private key (never stored in CI).
# PROTECTED_PROJECT_REF, when set, blocks restoring onto that project.

set -Eeuo pipefail

ARCHIVE="${1:-}"
TARGET=""
STORAGE_OUT=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --storage-out) STORAGE_OUT="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || die "usage: $0 <backup.tar.gz.age> [--target <database-url> --storage-out <new-directory>]"
[ -f "$ARCHIVE" ] || die "no such file: $ARCHIVE"
[ -n "${AGE_KEY_FILE:-}" ] || die "AGE_KEY_FILE is not set"
[ -f "$AGE_KEY_FILE" ] || die "no such key file: $AGE_KEY_FILE"

if [ -n "$TARGET" ]; then
  [ -n "$STORAGE_OUT" ] || die "--target requires --storage-out so the restored blobs are preserved"
  [ ! -e "$STORAGE_OUT" ] && [ ! -L "$STORAGE_OUT" ] || die "storage output already exists; choose a new directory"
else
  [ -z "$STORAGE_OUT" ] || die "--storage-out requires --target"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> decrypting"
age -d -i "$AGE_KEY_FILE" -o "$WORK/archive.tar.gz" "$ARCHIVE" \
  || die "decryption failed — wrong key?"

echo "==> unpacking"
tar -xzf "$WORK/archive.tar.gz" -C "$WORK"
ROOT="$(find "$WORK" -maxdepth 1 -type d -name 'skillsetmind-*' | head -1)"
[ -n "$ROOT" ] || die "archive does not contain a skillsetmind-* directory"

[ -d "$ROOT/storage" ] || die "archive has no storage directory"
EXPECTED_FILES="$(awk '$1 == "storage_objects" { if (NF != 2) exit 1; print $2 }' "$ROOT/MANIFEST.txt")" \
  || die "invalid storage count in manifest"
[[ "$EXPECTED_FILES" =~ ^(0|[1-9][0-9]*)$ ]] || die "manifest must contain one valid storage_objects count"
FILES="$(find "$ROOT/storage" -type f -printf '.' | wc -c | tr -d '[:space:]')"
[ "$FILES" = "$EXPECTED_FILES" ] || die "storage file count does not match manifest; refusing incomplete backup"

echo
cat "$ROOT/MANIFEST.txt"
echo
echo "tables in dump:  $(grep -c '^CREATE TABLE' "$ROOT/database.sql" || true)"
echo "storage files:   $FILES (verified against manifest)"
echo "dump size:       $(wc -c < "$ROOT/database.sql" | tr -d ' ') bytes"

if [ -z "$TARGET" ]; then
  echo
  echo "Inspect-only. Nothing was restored."
  echo "To restore for real, re-run with --target <database-url> --storage-out <new-directory>."
  echo "Use a scratch project or a local Postgres — NEVER production."
  exit 0
fi

# Guard rail: the dump is --clean --if-exists, so pointing this at production
# drops and recreates every table in it. Refuse the protected project outright.
if [ -n "${PROTECTED_PROJECT_REF:-}" ] && [[ "$TARGET" == *"$PROTECTED_PROJECT_REF"* ]]; then
  die "refusing to restore onto the protected project. Restore to a scratch project, verify, then promote deliberately."
fi

echo
echo "==> restoring into the explicit target database"
read -r -p "This DROPS and recreates every table in the dump. Type RESTORE to continue: " confirm
[ "$confirm" = "RESTORE" ] || die "aborted"

# Export before mutating the database: a copy failure must not leave a restored
# database with no usable blobs. Only the temporary decrypt/unpack tree is erased.
mkdir -p -- "$(dirname -- "$STORAGE_OUT")"
mkdir -- "$STORAGE_OUT" || die "could not create a new storage output directory"
cp -a -- "$ROOT/storage/." "$STORAGE_OUT/" || die "storage export failed"
# COPY errors can contain private row values. Neither a console nor a raw log
# may receive the dump's output; keep a failure status and fixed error only.
psql "$TARGET" -X -v ON_ERROR_STOP=1 -f "$ROOT/database.sql" > /dev/null 2>&1 \
  || die "database restore failed"
echo "==> database restored. Storage files are preserved in $STORAGE_OUT (upload separately)."
