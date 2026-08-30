#!/usr/bin/env node
/**
 * Roda os smoke tests de RLS de supabase/tests/ contra um banco real.
 *
 * Eles existiam desde julho e NENHUM comando do repositório os executava: o
 * vitest só coleta `src/`, e o CI roda lint, tsc, vitest e build. O arquivo que
 * prova que ninguém consegue setar o próprio `activation_fee_paid_at` — ou
 * seja, que ninguém vira criador ativado sem pagar — nunca tinha sido executado
 * por automação nenhuma. Uma regressão de policy passava por todos os portões
 * verdes. (Auditoria de 2026-08-30, achado A-03.)
 *
 * Por que psql e não vitest: são scripts psql de verdade — usam \set, \gset e
 * ROLE — e, por desenho, precisam de um banco COM DADOS (o primeiro passo é
 * `SELECT uid FROM public.users LIMIT 1`). Cada um roda dentro de uma
 * transação que faz rollback, então são seguros contra um banco vivo.
 *
 * Uso:
 *   DATABASE_URL='postgresql://...' npm run test:db
 *
 * Requisitos: `psql` no PATH e um banco alcançável com dados de teste.
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
    // -v ON_ERROR_STOP=1 é redundante (os arquivos já trazem \set ON_ERROR_STOP
    // on) e barato: garante saída não-zero mesmo se alguém remover a linha.
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
