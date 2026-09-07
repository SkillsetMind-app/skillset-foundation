#!/usr/bin/env bash
# Off-site backup of the Supabase project: Postgres dump + Storage objects,
# encrypted, ready to ship to R2 and Drive.
#
# Why this exists alongside Supabase's own daily backups: those live in the same
# account as the data and are kept 7 days. They cover "I dropped a table". They
# do not cover losing access to the account, and they explicitly EXCLUDE Storage
# objects — the dashboard says so on the Backups page. This covers both.
#
# Produces ONE encrypted archive on stdout path. Decryption needs the age
# private key, which never touches CI.
#
#   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
#   AGE_PUBLIC_KEY=age1... ./scripts/backup-supabase.sh [outdir]

set -Eeuo pipefail

OUT_DIR="${1:-./backup-out}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
NAME="skillsetmind-${STAMP}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

die() { echo "::error title=Backup failed::$*" >&2; exit 1; }

for var in DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AGE_PUBLIC_KEY; do
  [ -n "${!var:-}" ] || die "$var is not set"
done

mkdir -p "$OUT_DIR" "$WORK/$NAME/storage"

# --- Postgres ---------------------------------------------------------------
# --clean --if-exists so the dump can be replayed onto a non-empty database.
# Supabase-managed schemas are excluded: they're recreated by the platform and
# restoring them over a live project conflicts with its own migrations.
echo "==> pg_dump"
pg_dump "$DATABASE_URL" \
  --format=plain \
  --clean --if-exists \
  --no-owner --no-privileges \
  --quote-all-identifiers \
  --exclude-schema='supabase_migrations' \
  --exclude-schema='extensions' \
  --exclude-schema='graphql*' \
  --exclude-schema='pgbouncer' \
  --exclude-schema='realtime' \
  --exclude-schema='_realtime' \
  --exclude-schema='vault' \
  > "$WORK/$NAME/database.sql" || die "pg_dump exited non-zero"

DUMP_BYTES=$(wc -c < "$WORK/$NAME/database.sql" | tr -d ' ')
# A dump that "succeeded" but is tiny means we backed up nothing. Silent empty
# backups are worse than none — you only find out on the day you restore.
[ "$DUMP_BYTES" -ge 20000 ] || die "dump is only ${DUMP_BYTES} bytes; refusing to ship an empty backup"
grep -q "CREATE TABLE" "$WORK/$NAME/database.sql" || die "dump contains no CREATE TABLE"
echo "    ${DUMP_BYTES} bytes"

# --- Storage ----------------------------------------------------------------
# Supabase's own backups keep only the metadata rows in storage.objects, so the
# files themselves have to be fetched through the API.
echo "==> storage objects"
OBJ_COUNT=$(python3 scripts/backup-storage.py "$WORK/$NAME/storage") \
  || die "could not back up all Storage objects"
STORAGE_LAYOUT=paths-v1
[ ! -f "$WORK/$NAME/storage/INDEX.json" ] || STORAGE_LAYOUT=indexed-v2
echo "    $OBJ_COUNT object(s)"

# --- Manifest ---------------------------------------------------------------
cat > "$WORK/$NAME/MANIFEST.txt" <<MANIFEST
created_utc      ${STAMP}
database_bytes   ${DUMP_BYTES}
storage_objects  ${OBJ_COUNT}
storage_layout   ${STORAGE_LAYOUT}
pg_dump_version  $(pg_dump --version)
source_host      $(echo "$DATABASE_URL" | sed -E 's#.*@([^:/?]+).*#\1#')
restore          see docs/BACKUP.md
MANIFEST

# --- Package and encrypt ----------------------------------------------------
# Encrypted before it leaves this machine, so neither R2 nor Drive ever holds
# readable user data. Only the age private key can open it.
echo "==> packaging"
tar -czf "$WORK/$NAME.tar.gz" -C "$WORK" "$NAME"
age -r "$AGE_PUBLIC_KEY" -o "$OUT_DIR/$NAME.tar.gz.age" "$WORK/$NAME.tar.gz" \
  || die "age encryption failed"

# Paranoia: confirm the archive is really encrypted before it ships anywhere.
head -c 100 "$OUT_DIR/$NAME.tar.gz.age" | grep -q "age-encryption.org" \
  || die "output is not an age file — refusing to upload plaintext"

SIZE=$(wc -c < "$OUT_DIR/$NAME.tar.gz.age" | tr -d ' ')
echo "==> $OUT_DIR/$NAME.tar.gz.age (${SIZE} bytes, ${OBJ_COUNT} storage objects)"
echo "BACKUP_FILE=$OUT_DIR/$NAME.tar.gz.age"
