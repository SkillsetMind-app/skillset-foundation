#!/usr/bin/env bash
#
# Builds a disposable test database with the repository schema, for the RLS
# smoke tests in supabase/tests/.
#
# WHY THIS IS NOT JUST `supabase db reset`
# -----------------------------------------
# The supabase/migrations/ chain does NOT replay from scratch. The two
# migrations of 2026-07-04 alter policies on public.course_assets, but the
# table only appears in the 2026-07-15 baseline — which, by name order, runs
# later. `supabase db reset` dies on the second migration with
# `relation "public.course_assets" does not exist`.
#
# This is known and is written in the repository itself
# (supabase/SCHEMA_BASELINE_REPORT.md): the versioned history fell behind what
# was applied in production. The house answer is
# supabase/schema/remote_schema_2026-07-21.sql — in the file's own words, "a
# COMPLETE snapshot of the STRUCTURE of the public schema [...] rebuilt as
# replayable SQL. It exists because the repository could no longer rebuild the
# database".
#
# So the replayable truth of this repository is:
#
#     2026-07-21 baseline  +  the migrations after it
#
# That is exactly what this script applies. The migrations before the baseline
# stay versioned as a historical record; they are already inside the baseline
# and are not replayed.
#
# USAGE
#   DATABASE_URL='postgresql://...' scripts/build-test-db.sh
#
# NEVER point it at production: the seed writes.

set -euo pipefail

BASELINE="supabase/schema/remote_schema_2026-07-21.sql"
# Baseline prefix. Migrations whose name is strictly greater than this are
# later than it and must be applied on top.
CUTOFF="20260721"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  exit 2
fi

apply_sql() {
  echo "  $1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

# A setup/SQL failure does not prove a regression. Check only the ERROR line,
# never check names, which also appear in stdout when they pass.
# The subshell removes the temporary capture on any exit, without publishing
# the raw log.
prove_red() (
  local description="$1" expected="$2"
  shift 2
  local -a witnesses=()
  while [[ "${1:-}" != "--" ]]; do
    if [[ "$#" -eq 0 ]]; then return 2; fi
    witnesses+=("$1")
    shift
  done
  shift
  local output err_line witness status=0
  output="$(mktemp)"
  trap 'rm -f -- "$output"' EXIT
  "$@" >"$output" 2>&1 || status=$?
  err_line="$(sed -n 's/^.*ERROR:[[:space:]]*//p' "$output")"
  # expected is a glob pattern: only the checks aggregate accepts a
  # suffix.
  if [[ "$status" -eq 0 || "$err_line" == *$'\n'* || "$err_line" != $expected ]]; then
    echo "RED not proven ($description): the output or the error differs from the expected one." >&2
    printf '  Disposable database (synthetic fixtures), ERROR: %s\n' "${err_line%%$'\n'*}" >&2
    return 1
  fi
  for witness in "${witnesses[@]}"; do
    if [[ "$err_line" != *"$witness"* ]]; then
      echo "RED not proven ($description): a witness is missing from the aggregate error." >&2
      return 1
    fi
  done
  echo "  RED proven: $description"
)

# Two differences between a freshly created Supabase Postgres and production.
# They are not a setup detail: without fixing them, two smoke tests fail with
# no regression at all in the repository — and a gate that fails for the wrong
# reason becomes noise until someone turns it off.
echo "Environment:"

# (1) The local image ships default privileges that give EXECUTE to
# anon/authenticated on EVERY new function in the public schema. Production
# does not have this: there each function carries only the grant that some
# migration wrote, and that is what the baseline records. Without turning the
# defaults off, everything the baseline creates is born more open than in
# production — and 20260716000400 fails on claim_payout_transfer_reversal,
# which must be service-role-only.
echo "  default privileges for functions in public"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  alter default privileges in schema public
    revoke execute on functions from anon, authenticated;
"

# (2) Storage buckets are born through the API, not through a migration. The
# hardening in 20260723000100 is an `update storage.buckets ... where id =
# 'public-media'`: without the row it is a silent no-op and the matching smoke
# test fails. The properties (size limit, mime types) still come from the
# migration — here there is only the row it needs to find.
echo "  Storage buckets"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  insert into storage.buckets (id, name, public) values
    ('public-media',   'public-media',   true),
    ('course-content', 'course-content', false)
  on conflict (id) do nothing;
"

echo "Baseline:"
apply_sql "$BASELINE"

echo "Migrations after $CUTOFF:"
applied=0
for file in supabase/migrations/*.sql; do
  name="$(basename "$file")"
  if [[ "$name" > "$CUTOFF" ]]; then
    if [[ "$name" == "20260906020000_security_boundaries.sql" ]]; then
      # The same tests with the fix removed, before applying the real SQL.
      # Each connection fails and fully rolls back its transaction/fixtures.
      prove_red "smoke without 0200 (public curriculum, Stripe and MFA)" 'SECURITY_BOUNDARY_REGRESSION: *' \
        'public curriculum contains no lesson text or URLs' \
        'teacher cannot change the connected account' \
        'aal1 admin cannot grant platform roles' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "supabase/tests/20260906020000_security_boundaries_smoke.sql"
      prove_red "upgrade without 0200" 'UPGRADE_BACKFILL_REGRESSION: legacy private content was not migrated' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260906020000_before.sql" \
        -f "supabase/tests/fixtures/20260906020000_after.sql"
      # Legacy data persists BEFORE the attempt: a refusal must roll back all
      # the DDL and keep the inline/private copies exactly as they were.
      for case_name in duplicate_courses duplicate_same_course duplicate_public_reference missing_id null_id empty_id whitespace_id nonstring_id; do
        if [[ "$case_name" == duplicate_* ]]; then
          expected_error='Unsafe lesson backfill: an inline lesson ID has multiple curriculum references'
        else
          expected_error='Unsafe lesson backfill: private inline content requires a nonblank string lesson ID'
        fi
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v backfill_case="$case_name" -q --single-transaction \
          -f "supabase/tests/fixtures/20260906020000_unsafe_backfill_before.sql"
        state_before="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -f "supabase/tests/fixtures/20260906020000_backfill_state.sql")"
        prove_red "preflight refuses $case_name" "$expected_error" -- \
          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$file"
        state_after="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -f "supabase/tests/fixtures/20260906020000_backfill_state.sql")"
        if [[ ! "$state_before" =~ ^[0-9a-f]{32}$ || "$state_before" != "$state_after" ]]; then
          echo "Rollback of $case_name changed legacy content or left partial DDL." >&2
          exit 1
        fi
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
          -f "supabase/tests/fixtures/20260906020000_cleanup.sql"
        echo "  Rollback proven: $case_name (content preserved and fixtures removed)"
      done
      # Upgrade proof with data from before the change, in the disposable
      # database. The same transaction applies the migration, validates and
      # removes the fixtures.
      echo "  $file (upgrade/backfill with fixtures)"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260906020000_before.sql" \
        -f "$file" \
        -f "supabase/tests/fixtures/20260906020000_after.sql"
    elif [[ "$name" == "20260910061000_as_travas_de_producao_nascem_com_o_banco.sql" ]]; then
      # The baseline already ships these locks; without dropping them first, the
      # branch that creates each trigger would not run anywhere. Here the
      # migration gets a database without them and has to rebuild them (its
      # assertion fails if it does not).
      echo "  $file (on a database without the snapshot locks)"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260910061000_without_the_locks.sql" \
        -f "$file"
    elif [[ "$name" == "20260912020000_community_presence_private.sql" ]]; then
      prove_red "community presence without private authorization" \
        'COMMUNITY_PRESENCE_REGRESSION: private Realtime policies missing' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
        -f "supabase/tests/20260912020000_community_presence_private_smoke.sql"
      apply_sql "$file"
    elif [[ "$name" == "20261006030000_realtime_canais_privados_voltam_a_entrar.sql" ]]; then
      prove_red "Postgres Changes channel without a join policy" \
        'REALTIME_JOIN_REGRESSION: authenticated user cannot join a Postgres Changes channel' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
        -f "supabase/tests/20261006030000_realtime_canais_privados_voltam_a_entrar_smoke.sql"
      apply_sql "$file"
    else
      apply_sql "$file"
    fi
    applied=$((applied + 1))
  fi
done

# If the cutoff stops matching the names (rename, squash), the database would
# end up with the July schema and the smoke tests would fail for the wrong
# reason. Better to stop here and say why.
if [ "$applied" -eq 0 ]; then
  echo "No migration after $CUTOFF was found; the cutoff no longer matches the names in supabase/migrations/." >&2
  exit 2
fi

echo "Seed:"
apply_sql "supabase/schema/seed-teste.sql"

# Prove the same smoke catches premature access before Stripe cleanup. The
# mutation lives inside the smoke transaction and rolls back on its failure.
prove_red "waiver without Stripe confirmation" \
  'SMOKE_ASSERTION_FAILED: pending waiver unlocked activation before cleanup' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_waiver_ready_guard=1 -q \
    -f "supabase/tests/20260910010000_platform_invites_and_activation_waivers_smoke.sql"

prove_red "suspension without the session guard" \
  'ACCOUNT_CONTROL_REGRESSION: suspended session read private profile' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_account_session_guard=1 -q \
    -f "supabase/tests/20260910030000_operational_account_controls_smoke.sql"

prove_red "re-registration without the email guard" \
  'ACCOUNT_CONTROL_REGRESSION: blocked email registered again' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_account_email_guard=1 -q \
    -f "supabase/tests/20260910030000_operational_account_controls_smoke.sql"

prove_red "database without the production locks" 'PRODUCTION_GUARD_REGRESSION: *' \
  'client cannot insert payments' \
  'owner cannot publish by writing status' \
  'student cannot change the status of the own enrollment through RLS' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_production_guards=1 -q \
    -f "supabase/tests/20260910061000_as_travas_de_producao_nascem_com_o_banco_smoke.sql"

prove_red "user dossier without the admin gate" \
  'OPS_USER_DOSSIER_REGRESSION: non-admin read another person' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_user_dossier_admin_gate=1 -q \
    -f "supabase/tests/20260911010000_ops_user_dossier_smoke.sql"

prove_red "operational role without a second factor" \
  'PRIVILEGED_MFA_REGRESSION: password-only admin retained is_admin' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_privileged_aal2_guard=1 -q \
    -f "supabase/tests/20260912010000_operational_roles_require_aal2_smoke.sql"

echo "Test database ready: baseline + $applied migrations + seed."

prove_red "invite keeps a password set before the email proof" \
  'PLATFORM_INVITE_REGRESSION: pre-registered password does not survive the acceptance' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_invite_password_guard=1 -q \
    -f "supabase/tests/20260910064000_convite_nao_herda_senha_de_terceiro_smoke.sql"

prove_red "refund without the atomic certificate trigger" \
  'CERTIFICATE_REFUND_REGRESSION: refund left issued certificate' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_certificate_refund_trigger=1 -q \
    -f "supabase/tests/20261029010000_certificado_reembolso_atomico_smoke.sql"
