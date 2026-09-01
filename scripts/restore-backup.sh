#!/usr/bin/env bash
# Restores an encrypted backup produced by scripts/backup-supabase.sh.
#
# Default mode is inspect-only: decrypt, unpack, report what's inside, restore
# NOTHING. That is the mode you run monthly to prove the backups are real.
# Writing to a database requires --target with an explicit URL.
#
#   ./scripts/restore-backup.sh backup.tar.gz.age                  # inspect
#   ./scripts/restore-backup.sh backup.tar.gz.age --target "$URL"  # restore
#
# AGE_KEY_FILE must point at the age private key (never stored in CI).
# PROTECTED_PROJECT_REF, when set, blocks restoring onto that project.

set -Eeuo pipefail

ARCHIVE="${1:-}"
TARGET=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || die "usage: $0 <backup.tar.gz.age> [--target <database-url>]"
[ -f "$ARCHIVE" ] || die "no such file: $ARCHIVE"
[ -n "${AGE_KEY_FILE:-}" ] || die "AGE_KEY_FILE is not set"
[ -f "$AGE_KEY_FILE" ] || die "no such key file: $AGE_KEY_FILE"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> decrypting"
age -d -i "$AGE_KEY_FILE" -o "$WORK/archive.tar.gz" "$ARCHIVE" \
  || die "decryption failed — wrong key?"

echo "==> unpacking"
tar -xzf "$WORK/archive.tar.gz" -C "$WORK"
ROOT="$(find "$WORK" -maxdepth 1 -type d -name 'skillsetmind-*' | head -1)"
[ -n "$ROOT" ] || die "archive does not contain a skillsetmind-* directory"

echo
cat "$ROOT/MANIFEST.txt"
echo
echo "tables in dump:  $(grep -c '^CREATE TABLE' "$ROOT/database.sql" || true)"
echo "storage files:   $(find "$ROOT/storage" -type f | wc -l | tr -d ' ')"
echo "dump size:       $(wc -c < "$ROOT/database.sql" | tr -d ' ') bytes"

if [ -z "$TARGET" ]; then
  echo
  echo "Inspect-only. Nothing was restored."
  echo "To restore for real, re-run with --target <database-url>."
  echo "Use a scratch project or a local Postgres — NEVER production."
  exit 0
fi

# Guard rail: the dump is --clean --if-exists, so pointing this at production
# drops and recreates every table in it. Refuse the protected project outright.
if [ -n "${PROTECTED_PROJECT_REF:-}" ] && [[ "$TARGET" == *"$PROTECTED_PROJECT_REF"* ]]; then
  die "refusing to restore onto the protected project. Restore to a scratch project, verify, then promote deliberately."
fi

echo
echo "==> restoring into $(echo "$TARGET" | sed -E 's#.*@([^:/?]+).*#\1#')"
read -r -p "This DROPS and recreates every table in the dump. Type RESTORE to continue: " confirm
[ "$confirm" = "RESTORE" ] || die "aborted"

psql "$TARGET" -v ON_ERROR_STOP=1 -f "$ROOT/database.sql"
echo "==> database restored. Storage files are in $ROOT/storage (upload separately)."
