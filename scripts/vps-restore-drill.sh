#!/usr/bin/env bash
# Runs on the Contabo VPS. Pulls the newest encrypted backup from R2, restores
# it into a local Postgres, and checks the result is sane.
#
# This is the standby copy AND the restore drill. A backup nobody has ever
# restored is a guess; this one gets restored every night, so a broken backup
# surfaces the next morning instead of on the worst day of the year.
#
# The VPS holds NO Supabase credential — only read access to the R2 bucket and
# the age private key. Losing the VPS does not expose the live project.
#
#   /opt/skillsetmind/vps-restore-drill.sh
#
# Expects /etc/skillsetmind-backup.env (chmod 600, root-owned) with:
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET
#   AGE_KEY_FILE, PGDATABASE_DR
# Optional DR_DIR overrides /var/lib/skillsetmind-dr for the retained copy.

set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-/etc/skillsetmind-backup.env}"
[ -r "$ENV_FILE" ] || { echo "ERROR: cannot read $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

DR_DB="${PGDATABASE_DR:-skillsetmind_dr}"
DR_DIR="${DR_DIR:-/var/lib/skillsetmind-dr}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { echo "[$(date -u +%FT%TZ)] $*"; }
die() { echo "[$(date -u +%FT%TZ)] ERROR: $*" >&2; exit 1; }

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"

log "finding newest backup"
NEWEST="$(rclone lsf "R2:$R2_BUCKET/daily/" --files-only | sort | tail -1)"
[ -n "$NEWEST" ] || die "no backups found in R2:$R2_BUCKET/daily/"
log "newest is $NEWEST"

# A backup older than 48h means the GitHub Action stopped running and nobody
# noticed. That is worth failing over, not just logging.
NEWEST_DATE="$(echo "$NEWEST" | sed -E 's/^skillsetmind-([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/')"
AGE_DAYS=$(( ( $(date -u +%s) - $(date -u -d "$NEWEST_DATE" +%s) ) / 86400 ))
[ "$AGE_DAYS" -le 2 ] || die "newest backup is ${AGE_DAYS} days old — the backup job has stopped running"

log "downloading"
rclone copy "R2:$R2_BUCKET/daily/$NEWEST" "$WORK/" --stats-one-line

log "decrypting"
age -d -i "$AGE_KEY_FILE" -o "$WORK/archive.tar.gz" "$WORK/$NEWEST" \
  || die "decryption failed"
tar -xzf "$WORK/archive.tar.gz" -C "$WORK"
ROOT="$(find "$WORK" -maxdepth 1 -type d -name 'skillsetmind-*' | head -1)"
[ -n "$ROOT" ] || die "unexpected archive layout"

[ -d "$ROOT/storage" ] || die "archive has no storage directory"
EXPECTED_FILES="$(awk '$1 == "storage_objects" { if (NF != 2) exit 1; print $2 }' "$ROOT/MANIFEST.txt")" \
  || die "invalid storage count in manifest"
[[ "$EXPECTED_FILES" =~ ^(0|[1-9][0-9]*)$ ]] || die "manifest must contain one valid storage_objects count"
FILES="$(find "$ROOT/storage" -type f -printf '.' | wc -c | tr -d '[:space:]')"
[ "$FILES" = "$EXPECTED_FILES" ] || die "storage file count does not match manifest; refusing incomplete backup"

log "restoring into $DR_DB"
# Rebuild from scratch each night so a partial restore can't masquerade as a
# good one by leaving yesterday's tables behind.
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS \"$DR_DB\";"
sudo -u postgres psql -q -c "CREATE DATABASE \"$DR_DB\";"
# COPY errors can contain private row values. Do not persist or relay the raw
# replay output to the drill logs, including on failure.
sudo -u postgres psql -X -q -d "$DR_DB" -v ON_ERROR_STOP=1 -f "$ROOT/database.sql" \
  > /dev/null 2>&1 || die "database restore failed"

# --- Prove the restore actually produced data -------------------------------
TABLES=$(sudo -u postgres psql -tAq -d "$DR_DB" -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")
USERS=$(sudo -u postgres psql -tAq -d "$DR_DB" -c \
  "select count(*) from auth.users;" 2>/dev/null || echo 0)

log "restored: ${TABLES} public tables, ${USERS} auth users"
[ "$TABLES" -ge 20 ] || die "only ${TABLES} tables restored — expected at least 20"
[ "$USERS" -ge 1 ] || die "auth.users is empty after restore"

# Older exporters could truthfully report zero files while omitting every nested
# object. Check the restored metadata too, before --delete can erase a good copy.
STORAGE_ROWS=$(sudo -u postgres psql -tAq -d "$DR_DB" -v ON_ERROR_STOP=1 -c \
  "select count(*) from storage.objects;") || die "could not verify restored Storage metadata"
[[ "$STORAGE_ROWS" =~ ^(0|[1-9][0-9]*)$ ]] || die "invalid restored Storage metadata count"
[ "$FILES" = "$STORAGE_ROWS" ] || die "storage files differ from restored storage.objects; keeping the previous Storage copy"

# Storage objects land on disk next to the database; keep the newest copy only.
STORAGE_DEST="$DR_DIR/storage"
mkdir -p "$STORAGE_DEST"
rsync -a --delete "$ROOT/storage/" "$STORAGE_DEST/"
SYNCED_FILES="$(find "$STORAGE_DEST" -type f -printf '.' | wc -c | tr -d '[:space:]')"
[ "$SYNCED_FILES" = "$FILES" ] || die "synced Storage count differs from verified backup"

log "storage: ${FILES} file(s) synced to $STORAGE_DEST"
log "OK — drill passed against $NEWEST"

# Leave a breadcrumb a monitor can scrape without parsing logs.
printf '{"ok":true,"backup":"%s","tables":%s,"users":%s,"files":%s,"checked_utc":"%s"}\n' \
  "$NEWEST" "$TABLES" "$USERS" "$FILES" "$(date -u +%FT%TZ)" \
  > "$DR_DIR/last-drill.json"
