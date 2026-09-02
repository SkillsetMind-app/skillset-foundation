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

echo "Baseline:"
aplica "$BASELINE"

echo "Migrations posteriores a $CORTE:"
aplicadas=0
for arquivo in supabase/migrations/*.sql; do
  nome="$(basename "$arquivo")"
  if [[ "$nome" > "$CORTE" ]]; then
    aplica "$arquivo"
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
