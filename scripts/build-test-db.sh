#!/usr/bin/env bash
#
# Monta um banco de teste descartável com o esquema do repositório, para os
# smoke tests de RLS de supabase/tests/.
#
# POR QUE ISTO NÃO É SÓ `supabase db reset`
# -----------------------------------------
# A cadeia de supabase/migrations/ NÃO replica do zero. As duas migrations de
# 2026-07-04 alteram policies de public.course_assets, mas a tabela só nasce no
# baseline de 2026-07-15 — que, por ordem de nome, roda depois. `supabase db
# reset` morre na segunda migration com
# `relation "public.course_assets" does not exist`.
#
# Isso é conhecido e está escrito no próprio repositório
# (supabase/SCHEMA_BASELINE_REPORT.md): o histórico versionado ficou para trás
# do que foi aplicado em produção. A resposta da casa é
# supabase/schema/remote_schema_2026-07-21.sql — nas palavras do arquivo, "um
# snapshot COMPLETO da ESTRUTURA do schema public [...] reconstruido em SQL
# replayavel. Ele existe porque o repositorio nao conseguia mais reconstruir o
# banco".
#
# Então a verdade replayável deste repositório é:
#
#     baseline de 2026-07-21  +  as migrations posteriores a ele
#
# É exatamente isso que este script aplica. As migrations anteriores ao baseline
# continuam versionadas como registro histórico; elas já estão dentro do
# baseline e não são reaplicadas.
#
# USO
#   DATABASE_URL='postgresql://...' scripts/build-test-db.sh
#
# NUNCA aponte para produção: o seed escreve.

set -euo pipefail

BASELINE="supabase/schema/remote_schema_2026-07-21.sql"
# Prefixo do baseline. Migrations com nome estritamente maior que isto são
# posteriores a ele e precisam ser aplicadas por cima.
CORTE="20260721"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL não definida." >&2
  exit 2
fi

aplica() {
  echo "  $1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

# Uma falha de setup/SQL não prova regressão. Confira somente a linha ERROR,
# nunca nomes de checks que também aparecem no stdout quando passam.
# O subshell remove a captura temporária em qualquer saída, sem publicar log cru.
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
  # esperado é um padrão glob: só o agregado de checks aceita um sufixo.
  if [[ "$status" -eq 0 || "$erro" == *$'\n'* || "$erro" != $esperado ]]; then
    echo "RED não comprovado ($descricao): saída ou erro diferente do esperado." >&2
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

# Duas diferenças entre um Postgres do Supabase recém-criado e produção. Elas
# não são detalhe de setup: sem corrigir, dois smoke tests reprovam sem que haja
# regressão nenhuma no repositório — e um portão que reprova por motivo errado
# vira ruído até alguém desligá-lo.
echo "Ambiente:"

# (1) A imagem local traz default privileges que dão EXECUTE a anon/authenticated
# em TODA função nova do schema public. Produção não tem isso: lá cada função
# carrega só o grant que alguma migration escreveu, e é isso que o baseline
# registra. Sem desligar os defaults, tudo que o baseline cria nasce mais aberto
# do que em produção — e 20260716000400 reprova em claim_payout_transfer_reversal,
# que deve ser service-role-only.
echo "  default privileges de funções em public"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  alter default privileges in schema public
    revoke execute on functions from anon, authenticated;
"

# (2) Buckets do Storage nascem pela API, não por migration. O hardening de
# 20260723000100 é um `update storage.buckets ... where id = 'public-media'`:
# sem a linha ele é no-op silencioso e o smoke test correspondente reprova. As
# propriedades (limite de tamanho, mime types) continuam vindo da migration —
# aqui só existe a linha que ela precisa encontrar.
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
      # Mesmos testes com a correção removida, antes de aplicar o SQL real.
      # Cada conexão falha e reverte sua transação/fixtures por completo.
      prova_red "smoke sem 0200 (currículo público, Stripe e MFA)" 'SECURITY_BOUNDARY_REGRESSION: *' \
        'public curriculum contains no lesson text or URLs' \
        'teacher cannot change the connected account' \
        'aal1 admin cannot grant platform roles' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "supabase/tests/20260906020000_security_boundaries_smoke.sql"
      prova_red "upgrade sem 0200" 'UPGRADE_BACKFILL_REGRESSION: legacy private content was not migrated' -- \
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260906020000_before.sql" \
        -f "supabase/tests/fixtures/20260906020000_after.sql"
      # Prova de upgrade com dados anteriores à mudança, no banco descartável.
      # A mesma transação aplica a migration, valida e remove as fixtures.
      echo "  $arquivo (upgrade/backfill com fixtures)"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
        -f "supabase/tests/fixtures/20260906020000_before.sql" \
        -f "$arquivo" \
        -f "supabase/tests/fixtures/20260906020000_after.sql"
    else
      aplica "$arquivo"
    fi
    aplicadas=$((aplicadas + 1))
  fi
done

# Se o corte parar de casar com os nomes (renomeação, squash), o banco sairia
# com o esquema de julho e os smoke tests reprovariam por motivo errado. Melhor
# parar aqui e dizer o porquê.
if [ "$aplicadas" -eq 0 ]; then
  echo "Nenhuma migration posterior a $CORTE foi encontrada; o corte não bate mais com os nomes em supabase/migrations/." >&2
  exit 2
fi

echo "Seed:"
aplica "supabase/schema/seed-teste.sql"

echo "Banco de teste pronto: baseline + $aplicadas migrations + seed."
