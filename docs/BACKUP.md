# Backup and restore

## What already exists without us

Supabase takes a **daily physical backup**, kept **7 days** on the Pro plan.
They are on Database → Backups and restore with one click.

Two things they do not cover, and both are why this document exists:

1. **Storage objects are excluded.** The dashboard says so on that page. The
   backup holds the rows in `storage.objects`, not the files. Restoring an old
   backup does not bring back a deleted file.
2. **They live in the same account as the data.** Lose access to the account —
   suspension, an unpaid invoice, a compromised login — and the backups go with
   it. Anything older than 7 days is already gone.

Point-in-Time Recovery is a **paid add-on and is currently off**. At 8 users and
17 MB it is not worth buying yet. Revisit when real money moves through the
platform and losing an hour of transactions starts to hurt.

## What this repo adds

```
GitHub Action (daily 04:10 UTC)
  ├── pg_dump  ──────────┐
  ├── Storage objects ───┤──> tar.gz ──> age encrypt ──> Cloudflare R2 (30d)
  └── manifest ──────────┘                                      │
                                                                v
                                     Configured VPS (nightly) ─── restores it
                                                                    into local
                                                                    Postgres
```

The archive is encrypted **before it leaves the runner**, so R2 receives an
encrypted file. The VPS decrypts it and keeps a restricted, readable database
and file copy for recovery. The age private key opens the archive and is never
in CI; this does not imply that the VPS disks are encrypted.

The CI half only ever writes. It cannot list the bucket and it cannot delete
from it, so the workflow contains no step that does either — verification and
retention happen outside CI on purpose.

When installed, configured and scheduled, the VPS drill restores the newest
backup each night and records whether verification passed. The read-only
preflight on 2026-09-06 found no drill, helper, environment file, age key or
matching cron on the checked VPS. These are tested scripts; an operational
standby has not been verified. Confirm a recent successful drill and its
`last-drill.json` before relying on a retained recovery copy.

| Layer | Covers | Recovery time |
|---|---|---|
| Supabase daily (7d) | dropped table, bad migration | minutes |
| R2 archive (30d) | lost account, damage found late, deleted files | ~1 hour |
| Configured VPS standby | Supabase itself unavailable | depends on the last successful drill |

## One-time setup

### 1. Encryption key

Generate on your machine, **not** in CI:

```bash
age-keygen -o skillsetmind-backup.key
```

The public key (`age1...`) goes into CI. The private key goes into your password
manager **and** onto the VPS at `/root/skillsetmind-backup.key` (chmod 600).

> Lose this key and every archive is permanently unreadable. It is the one piece
> with no recovery path — store it somewhere you would store the deed to a house.

### 2. Cloudflare R2

1. R2 → create bucket, e.g. `skillsetmind-backups`, in a region away from the
   Supabase project.
2. Create an API token scoped **to that bucket only**:
   - CI token: **Object Write** only. A leaked CI token must not be able to read
     old backups or delete them.
   - VPS token: **Object Read** only.
3. Note the S3 endpoint: `https://<account-id>.r2.cloudflarestorage.com`.
4. Set retention **on the bucket**, not in the workflow: a lifecycle rule that
   expires objects under `daily/` after 30 days. It lives there rather than as a
   prune step because pruning from CI would require giving CI a token that can
   delete backups, which defeats the write-only scoping above.

   ```
   PUT /accounts/<account-id>/r2/buckets/<bucket>/lifecycle
   {"rules":[{"id":"expira-30-dias","enabled":true,
              "conditions":{"prefix":"daily/"},
              "deleteObjectsTransition":{"condition":{"type":"Age","maxAge":2592000}}}]}
   ```

### 3. GitHub secrets

Settings → Secrets and variables → Actions:

| Secret | Where to find it |
|---|---|
| `BACKUP_DATABASE_URL` | Supabase → Connect → Session pooler URI |
| `BACKUP_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `BACKUP_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` |
| `BACKUP_AGE_PUBLIC_KEY` | the `age1...` string from step 1 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | the write-only token |
| `R2_ENDPOINT` | the S3 endpoint |
| `R2_BUCKET` | the bucket name |

Without these the workflow **fails loudly** rather than passing with an empty
backup. A green tick over no data is the failure mode that hurts most.

Then run it once by hand: Actions → Backup → Run workflow. Do not wait for the
first scheduled run to discover a typo.

### 4. Contabo VPS

Ubuntu 22.04/24.04:

```bash
# Postgres 17 to match the server
sudo apt update && sudo apt install -y postgresql-17 age rclone rsync python3

# Bind to localhost only. This box holds student data; it must not answer
# from the internet.
sudo sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" \
  /etc/postgresql/17/main/postgresql.conf
sudo systemctl restart postgresql

# Firewall: SSH only
sudo ufw allow OpenSSH && sudo ufw --force enable
sudo ufw status   # 5432 must NOT appear
```

Put the read-only credentials in `/etc/skillsetmind-backup.env`:

```bash
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=skillsetmind-backups
AGE_KEY_FILE=/root/skillsetmind-backup.key
PGDATABASE_DR=skillsetmind_dr
```

```bash
sudo chmod 600 /etc/skillsetmind-backup.env /root/skillsetmind-backup.key
sudo chown root:root /etc/skillsetmind-backup.env /root/skillsetmind-backup.key
```

Install the drill and schedule it two hours after the backup job:

```bash
sudo install -m 700 scripts/vps-restore-drill.sh /opt/skillsetmind/vps-restore-drill.sh
sudo install -m 700 scripts/backup-storage.py /opt/skillsetmind/backup-storage.py
sudo crontab -e
# 10 6 * * * /opt/skillsetmind/vps-restore-drill.sh >> /var/log/skillsetmind-drill.log 2>&1
```

Run it once manually first. It fails loudly if the newest backup is more than
48 hours old — that is the alarm for "the GitHub Action quietly stopped".
Install the current drill and `backup-storage.py` together. Both restore scripts
require this Python standard-library helper beside them to validate Storage
before database restoration or replacing the retained files. Validation needs
no Supabase credentials and makes no network request.

## Restoring for real

**Inspect an archive** (restores nothing — this is the safe default):

```bash
AGE_KEY_FILE=~/skillsetmind-backup.key ./scripts/restore-backup.sh backup.tar.gz.age
```

**Restore into a scratch database:**

```bash
AGE_KEY_FILE=~/skillsetmind-backup.key \
PROTECTED_PROJECT_REF=<production-ref> \
./scripts/restore-backup.sh backup.tar.gz.age --target "postgres://..." \
  --storage-out ./recovered-storage
```

The script refuses the project named in `PROTECTED_PROJECT_REF` and asks you to
type `RESTORE` before touching anything. The dump is `--clean --if-exists`: it
drops and recreates every table it contains.

`--storage-out` must name a new directory. The files remain there after the
temporary decrypted database dump is removed. Inspect mode exports nothing.
On POSIX systems the export directory and the retained `DR_DIR` are protected
with mode `0700`; an existing `DR_DIR` is restricted before the drill writes.
The export copies bytes without importing the source directory's permissions.
The drill opens the dump as the operator and passes it to postgres on stdin,
so postgres does not need access through the private temporary directory.
The manifest count is checked before restoration; the VPS drill also checks
the restored Storage metadata before replacing its previous file copy.

Storage normally retains the existing `storage/<bucket>/<object-key>` layout.
Storage folders are key prefixes, so an object named `foo` can coexist with
`foo/bar`. If object paths collide on disk, the archive instead contains
`storage/objects/<number>` blobs and a version 2 `storage/INDEX.json`. Each index
entry records the original `bucket`, `key`, and relative blob `path`. The index
is retained by `--storage-out` and the VPS drill, and is excluded from the
object count after its version, unique mappings, paths and file inventory pass
validation. Symlinks and missing or unindexed blobs are refused.
The manifest declares `storage_layout` as `paths-v1` or `indexed-v2`, so a
missing index cannot be mistaken for an ordinary directory. Old manifests
without this field remain supported; unknown or conflicting formats are refused.

Current readers accept both layouts. Older readers count the index as an extra
file and reject indexed archives before restoring the database or replacing
Storage, so update the readers before enabling the new exporter. To re-upload
an indexed export, read each entry's `path` for its bytes and use its original
`bucket` and `key` in the Storage API; do not upload the index or use the numbered
blob filenames as object keys. The drill preserves recovery material beside
the database; it does not run or restore a functioning Storage API.

**Real recovery order**, if production is actually lost:

1. Restore the database into a **new** Supabase project.
2. Re-upload the exported blobs through the Storage API, using `INDEX.json` when
   present to recover their original bucket and key — the dump does not carry files.
3. Point `NEXT_PUBLIC_SUPABASE_URL` and the keys at the new project.
4. Redo Authentication → URL Configuration and the six email templates. They are
   dashboard config, not database rows, so **no backup contains them**. The
   templates are in `supabase/templates/`; regenerate with
   `node scripts/build-email-templates.mjs`.

Step 4 is the one people forget and discover during the outage.

## What is still not covered

- **Dashboard configuration** — auth settings, URL allowlist, email templates,
  RLS toggles set through the UI. Templates are in the repo; the rest is not.
- **Edge Function secrets and env vars.**
- **The age private key.** If it is lost, every archive is scrap.
- **Restoring onto the same project** is deliberately blocked. Recovery goes to
  a fresh project, gets verified, and is promoted on purpose.
