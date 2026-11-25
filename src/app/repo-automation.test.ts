import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards on the repository's own automation: gates that pass green without
 * inspecting anything are worse than missing gates, because they buy
 * confidence without delivering coverage.
 *
 * They came from the 2026-08-30 audit (A-03, A-18, A-10), where they lived in a
 * suite outside `src/` that no automation ran — the same disease they
 * diagnose.
 */
const RAIZ = process.cwd();
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("the RLS smoke tests must be run by some automation", () => {
  // The bug (A-03): there are 4 RLS smoke test files in supabase/tests/. One of
  // them proves that nobody can set their own activation_fee_paid_at, that is,
  // that nobody becomes an activated creator without paying. No command in the
  // repository ran them: vitest collects only src/, and CI ran lint, tsc,
  // vitest and build. A policy regression got through every green gate.
  const packageJson = leia("package.json");
  const ci = leia(".github/workflows/ci.yml");
  const vitestConfig = leia("vitest.config.ts");

  it("some automation in the repository runs the tests in supabase/tests/", () => {
    // Three acceptable paths; ONE is enough. The requirement is that automation
    // exists, not that a specific mechanism exists.
    const roda = /supabase\s+test|pgtap|pg_prove|supabase\/tests/;
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;

    const porScript = Object.values(scripts).some((cmd) => roda.test(cmd));
    const porCi = roda.test(ci);
    const porVitest = /supabase\/tests/.test(vitestConfig);

    expect(
      porScript || porCi || porVitest,
      `no path runs the RLS tests. scripts: ${Object.keys(scripts).join(", ")}`,
    ).toBe(true);
  });

  it("CI makes the gap visible when the database tests cannot run", () => {
    // Without a configured staging database they do not run — and that has to
    // SHOW UP in every run, instead of the pipeline staying green and faking
    // coverage.
    const avisa = /::warning/.test(ci) && /RLS|supabase\/tests/.test(ci);

    expect(avisa, "CI stays silent when the RLS tests do not run").toBe(true);
  });
});

describe("the secrets scan must scan something", () => {
  // The bug (A-18): TruffleHog received `base: <default_branch>` and no `head`.
  // On a push to main, base and head are the same commit: the range is empty,
  // zero commits are inspected, and the job ends green. The same held for the
  // Sunday cron, which the file calls "weekly full history secret scan".
  const wf = leia(".github/workflows/security.yml");

  it("does not scan an empty range on the push to main and on the cron", () => {
    const temBase = /^\s*base:/m.test(wf);
    const temHead = /^\s*head:/m.test(wf);

    // Two correct outcomes: either the base goes away (full scan), or it comes
    // with a head that makes it a real range.
    expect(
      !temBase || temHead,
      "there is a `base:` without a `head:` — on push/cron the range is main..main, that is, nothing",
    ).toBe(true);
  });

  it("the weekly scan covers the history, as the file promises", () => {
    const prometeHistorico = /full history/i.test(wf);
    expect(
      prometeHistorico,
      "test premise: the file promises to scan the history",
    ).toBe(true);

    const baseFixo =
      /base:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(wf);
    expect(
      baseFixo,
      "a fixed base on the default branch cancels the history scan",
    ).toBe(false);
  });
});

describe("HSTS with preload must not leak to the teacher's domain", () => {
  // The bug (A-10): the header was sent on `source: "/:path*"`, with no host
  // condition. Since the platform serves third-party domains (#105), it told
  // the browser to force HTTPS for 2 years on ALL of the teacher's subdomains
  // and to submit their name to the preload list — an effect on a domain that
  // is not ours, that the owner did not ask for, and that they cannot undo
  // quickly.
  const cfg = leia("next.config.ts");

  it("the broad HSTS is only sent on the platform's own host", () => {
    const indice = cfg.indexOf("Strict-Transport-Security");
    expect(indice, "next.config.ts does not define Strict-Transport-Security").toBeGreaterThan(-1);

    const bloco = cfg.slice(Math.max(0, indice - 900), indice + 300);

    expect(/preload/.test(bloco), "test premise: the header includes preload").toBe(true);

    // Next lets a header be conditioned on the host with `has: [{ type: "host" }]`.
    const condicionadoPorHost = /has:\s*\[/.test(bloco) && /type:\s*"host"/.test(bloco);

    expect(
      condicionadoPorHost,
      "the header is sent with no host condition: the preload leaks to the teacher's domain",
    ).toBe(true);
  });
});
