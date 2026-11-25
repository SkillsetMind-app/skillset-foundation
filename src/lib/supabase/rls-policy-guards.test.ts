import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard over the EFFECTIVE RLS POLICIES, sibling of `rpc-definition-guards`.
 *
 * The rule it proves already existed in SQL, at the end of
 * 20260809080000_enrollment_status_rls.sql: no policy may query `enrollments`
 * without also checking the status — the row is never deleted, it only changes
 * status, so "an enrollment exists" is not the same question as "the enrollment
 * still grants access".
 *
 * It is here in TypeScript for two reasons. The first is that the SQL version
 * runs once, on the day the migration is applied; this one runs on every PR. The
 * second is what today's audit found: that guard read only
 * `pg_get_expr(p.polqual, ...)`, the USING clause. An INSERT policy has no
 * USING — its predicate lives in WITH CHECK —, so the guard went green on the
 * same day `lesson_comments_insert` was left behind, and the next day it let
 * `member_stats_select_authenticated` through.
 *
 * The next blind spot was the regex itself: it only matched `create policy`, and
 * a policy redefined by `alter policy` was invisible. In PR #253,
 * `courses_delete_owner` was rewritten that way reading `enrollments` without a
 * status, this guard went green and only the smoke test against the database
 * caught it — exactly the case where it should have spoken first.
 *
 * The criterion is textual, not semantic: it proves that the status was
 * checked, not that it was checked in the right place. That is on purpose — what
 * it catches is forgetting, which is how the three violations of this series
 * were born.
 */
const ROOT = process.cwd();

/**
 * Documented exceptions. The list has to be the same as the one in the database
 * smoke test
 * (supabase/tests/20260901180000_dead_enrollments_lose_the_classroom_smoke.sql);
 * the test "has the same list of exceptions" proves it.
 *
 * - lesson_progress_select_owner: returns the user's OWN history, which is
 *   theirs whether the enrollment is live or dead.
 * - courses_delete_owner: the only DELETE policy, and for it the question is
 *   the inverse — it queries `enrollments` in a NOT EXISTS to REFUSE, not to
 *   allow. A refunded, revoked or expired enrollment is still the learner's
 *   record, and `enrollments_course_id_fkey` is RESTRICT: filtering by status
 *   here would OPEN the hole, a course with a dead enrollment would become
 *   deletable again. See 20260908120000_excluir_ou_arquivar_curso_do_professor.sql.
 */
const EXCEPTIONS = new Set(["lesson_progress_select_owner", "courses_delete_owner"]);

type Policy = { table: string; body: string; file: string };

function sqlFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith(".sql"))
    .sort() // names start with a date, so alphabetical order = chronological
    .map((file) => join(dir, file));
}

/** `create policy` and `alter policy` from ONE SQL file, in the order they appear. */
function policyDefinitions(text: string, file: string): Array<[string, Policy]> {
  const definitions = text.matchAll(
    /\b(?:create|alter)\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+"?([a-z0-9_."]+)"?([\s\S]*?);/gi,
  );

  return [...definitions].map(([, name, table, body]) => [
    name.toLowerCase(),
    { table: table.replace(/"/g, ""), body, file },
  ]);
}

/**
 * Last definition of each policy in the chain: `create policy` creates it, `alter
 * policy` redefines it, and the last one wins. Looking at where the policy was
 * born would give a permanent red after the fix, because an old migration is not
 * edited, it is replaced.
 *
 * `alter policy` only swaps the clauses it names, but here the text of the last
 * statement counts as the whole body — the same simplification as `policyEfetiva`
 * in rpc-definition-guards. It is enough, because the clause it does NOT name
 * was already judged when it was born.
 */
function effectivePolicies(): Map<string, Policy> {
  const efetivas = new Map<string, Policy>();
  const files = [...sqlFiles("supabase/schema"), ...sqlFiles("supabase/migrations")];

  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [name, policy] of policyDefinitions(text, file)) {
      efetivas.set(name, policy);
    }
  }

  return efetivas;
}

/** Policies that query `enrollments` without also checking the status. */
function policiesWithoutStatus(efetivas: Map<string, Policy>): string[] {
  return [...efetivas.entries()]
    .filter(([name, { body }]) => {
      if (EXCEPTIONS.has(name)) return false;
      return /\benrollments\b/i.test(body) && !/e\.status/i.test(body);
    })
    .map(([name, { table, file }]) => `${table}.${name} (${file})`);
}

describe("RLS policies that read enrollments", () => {
  const efetivas = effectivePolicies();

  it("finds the repository policies", () => {
    // Without this, a broken regex would leave the test below green for having
    // looked at nothing — the quietest failure mode this file has.
    expect(efetivas.size).toBeGreaterThan(100);
  });

  it("checks the enrollment status in every policy that queries it", () => {
    const infratoras = policiesWithoutStatus(efetivas);

    expect(
      infratoras,
      "These policies grant access because the enrollment row EXISTS, not "
        + "because it still grants access. A refunded, revoked or "
        + "expired learner gets through them. Add `and e.status = any (array['active', "
        + "'completed'])` to the EXISTS, or justify the exception in EXCECOES:\n  "
        + infratoras.join("\n  "),
    ).toEqual([]);
  });

  it("sees a policy redefined by alter policy", () => {
    // The hole in PR #253: courses_delete_owner was born clean and was rewritten
    // by `alter policy` reading enrollments without a status. The regex only saw
    // `create`, the assertion above stayed green, and only the database smoke
    // test caught it.
    const fixture = [
      "create policy fixture_owner on public.fixture using (owner_id = auth.uid());",
      "alter policy fixture_owner on public.fixture",
      "  using (exists (select 1 from public.enrollments e where e.course_id = fixture.id));",
    ].join("\n");

    expect(policiesWithoutStatus(new Map(policyDefinitions(fixture, "fixture.sql")))).toEqual([
      "public.fixture.fixture_owner (fixture.sql)",
    ]);
  });

  it("has the same list of exceptions as the database smoke test", () => {
    // Both guards prove the same rule, so an exception that only one side
    // knows about is a hole in the other. The smoke test excludes by `p.polname <> '...'`.
    const smoke = readFileSync(
      join(ROOT, "supabase/tests/20260901180000_dead_enrollments_lose_the_classroom_smoke.sql"),
      "utf8",
    );
    const noSmoke = [...smoke.matchAll(/p\.polname\s*<>\s*'([a-z0-9_]+)'/g)]
      .map(([, name]) => name);

    expect(new Set(noSmoke)).toEqual(EXCEPTIONS);
  });

  it("keeps the SQL guard looking at WITH CHECK as well", () => {
    // The SQL guard is the one that runs against the real database. While it read
    // only `polqual`, it was blind to every INSERT policy — the hole this series
    // of fixes closed. If someone rewrites it without `polwithcheck`, the blind
    // spot comes back and this file becomes the only defense.
    const guardas = sqlFiles("supabase/migrations")
      .map((file) => readFileSync(join(ROOT, file), "utf8"))
      .filter((text) => text.includes("polqual"));

    expect(guardas.length).toBeGreaterThan(0);
    expect(guardas.at(-1)).toMatch(/polwithcheck/);
  });
});
