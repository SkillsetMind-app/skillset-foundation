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

const TESTS_DIR = process.argv[2] ?? "supabase/tests";
const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "These tests need a database with data (they read a real user and " +
      "roll everything back at the end). Point it at staging, never at production " +
      "without reading the files first.",
  );
  process.exit(2);
}

const files = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql file found in ${TESTS_DIR}`);
  process.exit(2);
}

let failures = 0;
for (const file of files) {
  const filePath = join(TESTS_DIR, file);
  process.stdout.write(`  ${file} ... `);
  try {
    // -v ON_ERROR_STOP=1 is redundant (the files already carry \set
    // ON_ERROR_STOP on) and cheap: it guarantees a non-zero exit even if
    // someone removes that line.
    execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("ok");
  } catch (error) {
    failures += 1;
    console.log("FAILED");
    const output = [error.stdout?.toString(), error.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (output) console.error(output.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}

console.log(
  failures === 0
    ? `\n${files.length} database tests passed`
    : `\n${failures} of ${files.length} database tests FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
