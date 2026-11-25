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
CORTE="20260721"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL não definida." >&2
  exit 2
fi

aplica() {
  echo "  $1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

# A setup/SQL failure does not prove a regression. Check only the ERROR line,
# never check names, which also appear in stdout when they pass.
# The subshell removes the temporary capture on any exit, without publishing
# the raw log.
prova_red() (
  local descricao="$1" esperado="$2"
  shift 2
  local -a testemunhas=()
  while [[ "${1:-}" != "--" ]]; do
    if [[ "$#" -eq 0 ]]; then return 2; fi
    testemunhas+=("$1")
    shift
  done
  shift
  local saida erro testemunha status=0
  saida="$(mktemp)"
  trap 'rm -f -- "$saida"' EXIT
  "$@" >"$saida" 2>&1 || status=$?
  erro="$(sed -n 's/^.*ERROR:[[:space:]]*//p' "$saida")"
  # esperado (expected) is a glob pattern: only the checks aggregate accepts a
  # suffix.
  if [[ "$status" -eq 0 || "$erro" == *$'\n'* || "$erro" != $esperado ]]; then
    echo "RED não comprovado ($descricao): saída ou erro diferente do esperado." >&2
    printf '  Banco descartável (fixtures sintéticas), ERROR: %s\n' "${erro%%$'\n'*}" >&2
    return 1
  fi
  for testemunha in "${testemunhas[@]}"; do
    if [[ "$erro" != *"$testemunha"* ]]; then
      echo "RED não comprovado ($descricao): testemunha ausente no erro agregado." >&2
      return 1
    fi
  done
  echo "  RED comprovado: $descricao"
)

# Two differences between a freshly created Supabase Postgres and production.
# They are not a setup detail: without fixing them, two smoke tests fail with
# no regression at all in the repository — and a gate that fails for the wrong
# reason becomes noise until someone turns it off.
echo "Ambiente:"

# (1) The local image ships default privileges that give EXECUTE to
# anon/authenticated on EVERY new function in the public schema. Production
# does not have this: there each function carries only the grant that some
# migration wrote, and that is what the baseline records. Without turning the
# defaults off, everything the baseline creates is born more open than in
# production — and 20260716000400 fails on claim_payout_transfer_reversal,
# which must be service-role-only.
echo "  default privileges de funções em public"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  alter default privileges in schema public
    revoke execute on functions from anon, authenticated;
"

# (2) Storage buckets are born through the API, not through a migration. The
# hardening in 20260723000100 is an `update storage.buckets ... where id =
# 'public-media'`: without the row it is a silent no-op and the matching smoke
# test fails. The properties (size limit, mime types) still come from the
# migration — here there is only the row it needs to find.
echo "  buckets do Storage"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  insert into storage.buckets (id, name, public) values
    ('public-media',   'public-media',   true),
    ('course-content', 'course-content', false)
  on conflict (id) do nothing;
"

echo "Baseline:"
aplica "$BASELINE"

echo "Migrations posteriores a $CORTE:"
aplicadas=0
for arquivo in supabase/migrations/*.sql; do
  nome="$(basename "$arquivo")"
  if [[ "$nome" > "$CORTE" ]]; then
    if [[ "$nome" == "20260906020000_security_boundaries.sql" ]]; then
      # The same tests with the fix removed, before applying the real SQL.
      # Each connection fails and fully rolls back its transaction/fixtures.
      prova_red "smoke sem 0200 (currículo público, Stripe e MFA)" 'SECURITY_BOUNDARY_REGRESSION: *' \
        'public curriculum contains no lesson text or URLs' \
        'teacher cannot change the connected account' \
        'aal1 admin cannot grant platform roles' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "supabase/tests/20260906020000_security_boundaries_smoke.sql"
      prova_red "upgrade sem 0200" 'UPGRADE_BACKFILL_REGRESSION: legacy private content was not migrated' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260906020000_before.sql" \
        -f "supabase/tests/fixtures/20260906020000_after.sql"
      # Legacy data persists BEFORE the attempt: a refusal must roll back all
      # the DDL and keep the inline/private copies exactly as they were.
      for caso in duplicate_courses duplicate_same_course duplicate_public_reference missing_id null_id empty_id whitespace_id nonstring_id; do
        if [[ "$caso" == duplicate_* ]]; then
          erro_esperado='Unsafe lesson backfill: an inline lesson ID has multiple curriculum references'
        else
          erro_esperado='Unsafe lesson backfill: private inline content requires a nonblank string lesson ID'
        fi
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v backfill_case="$caso" -q --single-transaction \
          -f "supabase/tests/fixtures/20260906020000_unsafe_backfill_before.sql"
        estado_antes="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -f "supabase/tests/fixtures/20260906020000_backfill_state.sql")"
        prova_red "preflight recusa $caso" "$erro_esperado" -- \
          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$arquivo"
        estado_depois="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -f "supabase/tests/fixtures/20260906020000_backfill_state.sql")"
        if [[ ! "$estado_antes" =~ ^[0-9a-f]{32}$ || "$estado_antes" != "$estado_depois" ]]; then
          echo "Rollback de $caso alterou conteudo legado ou deixou DDL parcial." >&2
          exit 1
        fi
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
          -f "supabase/tests/fixtures/20260906020000_cleanup.sql"
        echo "  Rollback comprovado: $caso (conteudo preservado e fixtures removidas)"
      done
      # Upgrade proof with data from before the change, in the disposable
      # database. The same transaction applies the migration, validates and
      # removes the fixtures.
      echo "  $arquivo (upgrade/backfill com fixtures)"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260906020000_before.sql" \
        -f "$arquivo" \
        -f "supabase/tests/fixtures/20260906020000_after.sql"
    elif [[ "$nome" == "20260910061000_as_travas_de_producao_nascem_com_o_banco.sql" ]]; then
      # The baseline already ships these locks; without dropping them first, the
      # branch that creates each trigger would not run anywhere. Here the
      # migration gets a database without them and has to rebuild them (its
      # assertion fails if it does not).
      echo "  $arquivo (sobre um banco sem as travas do snapshot)"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260910061000_sem_as_travas.sql" \
        -f "$arquivo"
    elif [[ "$nome" == "20260912020000_community_presence_private.sql" ]]; then
      prova_red "presenca da comunidade sem autorizacao privada" \
        'COMMUNITY_PRESENCE_REGRESSION: private Realtime policies missing' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
        -f "supabase/tests/20260912020000_community_presence_private_smoke.sql"
      aplica "$arquivo"
    elif [[ "$nome" == "20261006030000_realtime_canais_privados_voltam_a_entrar.sql" ]]; then
      prova_red "canal de Postgres Changes sem policy de entrada" \
        'REALTIME_JOIN_REGRESSION: authenticated user cannot join a Postgres Changes channel' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
        -f "supabase/tests/20261006030000_realtime_canais_privados_voltam_a_entrar_smoke.sql"
      aplica "$arquivo"
    else
      aplica "$arquivo"
    fi
    aplicadas=$((aplicadas + 1))
  fi
done

# If the cutoff stops matching the names (rename, squash), the database would
# end up with the July schema and the smoke tests would fail for the wrong
# reason. Better to stop here and say why.
if [ "$aplicadas" -eq 0 ]; then
  echo "Nenhuma migration posterior a $CORTE foi encontrada; o corte não bate mais com os nomes em supabase/migrations/." >&2
  exit 2
fi

echo "Seed:"
aplica "supabase/schema/seed-teste.sql"

# Prove the same smoke catches premature access before Stripe cleanup. The
# mutation lives inside the smoke transaction and rolls back on its failure.
prova_red "isencao sem confirmacao do Stripe" \
  'SMOKE_ASSERTION_FAILED: pending waiver unlocked activation before cleanup' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_waiver_ready_guard=1 -q \
    -f "supabase/tests/20260910010000_platform_invites_and_activation_waivers_smoke.sql"

prova_red "suspensao sem guarda de sessao" \
  'ACCOUNT_CONTROL_REGRESSION: suspended session read private profile' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_account_session_guard=1 -q \
    -f "supabase/tests/20260910030000_operational_account_controls_smoke.sql"

prova_red "recadastro sem guarda de email" \
  'ACCOUNT_CONTROL_REGRESSION: blocked email registered again' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_account_email_guard=1 -q \
    -f "supabase/tests/20260910030000_operational_account_controls_smoke.sql"

prova_red "banco sem as travas de producao" 'PRODUCTION_GUARD_REGRESSION: *' \
  'client cannot insert payments' \
  'owner cannot publish by writing status' \
  'student cannot change the status of the own enrollment through RLS' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_production_guards=1 -q \
    -f "supabase/tests/20260910061000_as_travas_de_producao_nascem_com_o_banco_smoke.sql"

prova_red "dossie sem o portao de admin" \
  'OPS_USER_DOSSIER_REGRESSION: non-admin read another person' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_user_dossier_admin_gate=1 -q \
    -f "supabase/tests/20260911010000_ops_user_dossier_smoke.sql"

prova_red "papel operacional sem segundo fator" \
  'PRIVILEGED_MFA_REGRESSION: password-only admin retained is_admin' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_privileged_aal2_guard=1 -q \
    -f "supabase/tests/20260912010000_operational_roles_require_aal2_smoke.sql"

echo "Banco de teste pronto: baseline + $aplicadas migrations + seed."

prova_red "convite preserva senha anterior a prova do email" \
  'PLATFORM_INVITE_REGRESSION: pre-registered password does not survive the acceptance' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_invite_password_guard=1 -q \
    -f "supabase/tests/20260910064000_convite_nao_herda_senha_de_terceiro_smoke.sql"

prova_red "reembolso sem trigger atomico de certificado" \
  'CERTIFICATE_REFUND_REGRESSION: refund left issued certificate' -- \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v without_certificate_refund_trigger=1 -q \
    -f "supabase/tests/20261029010000_certificado_reembolso_atomico_smoke.sql"
