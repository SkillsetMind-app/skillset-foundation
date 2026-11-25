#!/usr/bin/env node
/**
 * Runs the RLS smoke tests in supabase/tests/ against a real database.
 *
 * They had existed since July and NO command in the repository ran them: vitest
 * only collects `src/`, and CI runs lint, tsc, vitest and build. The file that
 * proves nobody can set their own `activation_fee_paid_at` (that is, nobody
 * becomes an activated creator without paying) had never been run by any
 * automation. A policy regression passed every green gate. (Audit of
 * 2026-08-30, finding A-03.)
 *
 * Why psql and not vitest: they are real psql scripts (they use \set, \gset and
 * ROLE) and, by design, need a database WITH DATA (the first step is
 * `SELECT uid FROM public.users LIMIT 1`). Each one runs inside a transaction
 * that rolls back, so they are safe against a live database.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' npm run test:db
 *
 * Requirements: `psql` on the PATH and a reachable database with test data.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const PASTA = process.argv[2] ?? "supabase/tests";
const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    "DATABASE_URL não definida.\n" +
      "Estes testes precisam de um banco com dados (eles leem um usuário real e " +
      "desfazem tudo no fim). Aponte para staging, nunca para produção sem ler os " +
      "arquivos antes.",
  );
  process.exit(2);
}

const arquivos = readdirSync(PASTA)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (arquivos.length === 0) {
  console.error(`Nenhum .sql encontrado em ${PASTA}`);
  process.exit(2);
}

let falhas = 0;
for (const arquivo of arquivos) {
  const caminho = join(PASTA, arquivo);
  process.stdout.write(`  ${arquivo} ... `);
  try {
    // -v ON_ERROR_STOP=1 is redundant (the files already carry \set
    // ON_ERROR_STOP on) and cheap: it guarantees a non-zero exit even if
    // someone removes that line.
    execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", caminho], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("ok");
  } catch (erro) {
    falhas += 1;
    console.log("FALHOU");
    const saida = [erro.stdout?.toString(), erro.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (saida) console.error(saida.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}

console.log(
  falhas === 0
    ? `\n${arquivos.length} testes de banco passaram`
    : `\n${falhas} de ${arquivos.length} testes de banco FALHARAM`,
);
process.exit(falhas === 0 ? 0 : 1);
