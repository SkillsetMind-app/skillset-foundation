import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards over the EFFECTIVE definition of Postgres functions that decide money
 * and abuse. They came from the 2026-08-30 audit (findings A-02 and DB-01),
 * where they lived in a suite outside `src/` that no automation ran — CI only
 * collects `src/**\/*.test.{ts,tsx}`, so they proved something nobody saw.
 *
 * Why read SQL instead of calling the function: what these two prove is about
 * the rule written in the migration, and the smoke tests that really run against
 * a database (supabase/tests/) depend on `STAGING_DATABASE_URL`, which does not
 * exist on every PR. This is the gate that always runs; it does not replace what
 * runs against the database.
 */
const ROOT = process.cwd();

describe("creator plan gate - definer boundaries", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261010010000_creator_plan_publish_gate.sql"), "utf8");

  it.each([
    ["creator_has_current_plan", "text", "service_role"],
    ["creator_plan_required", "", "authenticated, service_role"],
    ["course_owner_can_sell", "text", "service_role"],
    ["enforce_creator_plan_on_publish", "", null],
  ])("%s has a fixed path and explicit caller classification", (name, args, roles) => {
    const definition = sql.match(new RegExp(`function public\\.${name}\\([^]*?\\$\\$;`))?.[0];
    expect(definition).toMatch(/security definer set search_path = ''/);
    expect(sql).toContain(`revoke all on function public.${name}(${args}) from public, anon, authenticated;`);
    if (roles) {
      expect(sql).toContain(`grant execute on function public.${name}(${args}) to ${roles};`);
    } else {
      // Trigger-only: the browser never invokes it as an RPC.
      expect(sql).not.toContain(`grant execute on function public.${name}`);
      expect(definition).toContain("returns trigger");
    }
  });

  it("the browser verdict is self-only and requires a strong session", () => {
    expect(sql).toContain("function public.creator_plan_required()");
    expect(sql).toContain("perform public.require_strong_session();");
    expect(sql).toContain("return not public.creator_has_current_plan(auth.uid()::text);");
  });
});

describe("house accounts — plan_grants", () => {
  // A house account publishes without a subscription. The list is only written
  // through SQL: a policy on it would open the door for any account to give
  // itself Enterprise.
  it("the publish gate accepts the grant and still accepts a subscription", () => {
    const body = effectiveDefinition("creator_has_current_plan").split("$$;")[0];
    expect(body).toMatch(/from\s+public\.plan_grants/i);
    expect(body).toMatch(/from\s+public\.subscriptions/i);
    expect(body).toMatch(/security definer set search_path = ''/);
  });

  // Only the session lock (restrictive) is accepted: it only narrows. Without a
  // permissive policy, PostgREST neither reads nor writes anything in this table.
  it("plan_grants has RLS enabled and no permissive policy", () => {
    const all = migrationsText();
    expect(all).toMatch(/alter table public\.plan_grants enable row level security/i);
    const policies = [...all.matchAll(/policy\s+\S+\s+on\s+public\.plan_grants\b[^;]*/gi)].map((m) => m[0]);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toMatch(/\bas\s+restrictive\b/i);
  });
});

/**
 * Body of the LAST definition of a function in the migration chain.
 *
 * `create or replace` makes the most recent migration the truth. Looking at the
 * file where the function was born would give a permanent red even after the
 * fix, because an old migration is not edited — it is replaced.
 */
function effectiveDefinition(functionName: string): string {
  const dir = "supabase/migrations";
  const marcador = `function public.${functionName}`;
  const files = readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith(".sql"))
    .sort(); // names start with a date, so alphabetical order = chronological

  let last: string | null = null;

  for (const file of files) {
    const text = readFileSync(join(ROOT, dir, file), "utf8");
    const start = text.indexOf(marcador);

    if (start === -1) continue;

    const open = text.indexOf("$function$", start);
    const close = text.indexOf("$function$", open + 1);
    last = text.slice(start, close === -1 ? undefined : close);
  }

  expect(last, `no migration defines ${functionName}`).not.toBeNull();
  return last as string;
}

describe("create_free_course_enrollment — free enrollment and paid offer", () => {
  // The bug (A-02): the function decided whether the course was free by looking
  // only at the legacy columns of `courses` (payment_type and price_amount_minor).
  // A paid offer created with isDefault=false — the upsell path that
  // product_offers exists to support — does not update those columns. The course
  // charged 497 at checkout and was handed out for free by a one-line RPC call.
  const body = effectiveDefinition("create_free_course_enrollment");

  it("queries product_offers before granting the course", () => {
    expect(body).toMatch(/product_offers/);
  });

  it("does not decide the price from the legacy columns of courses alone", () => {
    const legacyOnly =
      /payment_type\s*=\s*'free'/.test(body)
      && /price_amount_minor/.test(body)
      && !/product_offers|product_prices/.test(body);

    expect(
      legacyOnly,
      "the price gate went back to being only payment_type + price_amount_minor: "
        + "a paid non-default offer gives the course away for free",
    ).toBe(false);
  });
});

describe("verify_skillset_certificate — the attempt-limit bucket", () => {
  // The bug (DB-01): the limit key was coalesce(auth.uid(), p_rate_key,
  // 'anon'). For someone who is not logged in, auth.uid() is null and the key
  // becomes a parameter the caller sends themselves — a new value on every
  // request gives a new bucket on every request. Worse: each never-seen key
  // INSERTS a permanent row in rate_limits, which has no cleanup. The
  // anti-abuse mechanism becomes the abuse vector.
  const body = effectiveDefinition("verify_skillset_certificate");

  it("does not use the raw caller key: the key space is bounded", () => {
    const usaCrua =
      /coalesce\(\s*\(?\s*select auth\.uid\(\)[\s\S]{0,120}p_rate_key/i.test(body)
      && !/md5\(|hashtext\(|substr\(/i.test(body);

    expect(
      usaCrua,
      "the key falls back to p_rate_key when auth.uid() is null, without bounding the space — "
        + "the anonymous caller picks their own bucket and each new bucket writes a permanent row",
    ).toBe(false);
  });

  it("a logged-in user gets a bucket from the identity the platform issued", () => {
    expect(body).toMatch(/auth\.uid\(\)/);
  });
});

describe("delete_or_archive_own_course — deleting must not become deleting for those who paid", () => {
  // The function is the teacher's only way to take a course offline, and the
  // outcome is decided HERE, not on the screen: with no enrollment and no order
  // the course disappears; with either one it goes to 'inactive' and whoever
  // bought it can still get in. If the archive branch is lost, the screen keeps
  // saying "your learners keep access" while the course is destroyed.
  const body = effectiveDefinition("delete_or_archive_own_course");

  it("counts enrollments and orders before choosing the outcome", () => {
    expect(body).toMatch(/from\s+public\.enrollments\s+where\s+course_id/i);
    expect(body).toMatch(/from\s+public\.orders\s+where\s+course_id/i);
  });

  it("has both branches: delete only when there is no buyer", () => {
    expect(body).toMatch(/v_enrollments\s*=\s*0\s+and\s+v_orders\s*=\s*0/i);
    expect(body).toMatch(/delete\s+from\s+public\.courses/i);
    expect(body).toMatch(/'outcome'\s*,\s*'deleted'/i);
  });

  it("archives instead of deleting when there is a buyer", () => {
    expect(body).toMatch(/update\s+public\.courses[\s\S]*status\s*=\s*'inactive'/i);
    expect(body).toMatch(/'outcome'\s*,\s*'archived'/i);

    // The DELETE may only exist inside the no-buyer branch: if it shows up
    // after the archive UPDATE, a course with a learner disappears too.
    const updatePosition = body.search(/update\s+public\.courses/i);
    const deletePosition = body.search(/delete\s+from\s+public\.courses/i);
    expect(
      deletePosition < updatePosition,
      "the delete from courses left the 'no buyer' branch",
    ).toBe(true);
  });

  it("owner only, with a strong session, and no hijackable search_path", () => {
    expect(body).toMatch(/security\s+definer/i);
    expect(body).toMatch(/set\s+search_path\s+to\s+'public',\s*'pg_temp'/i);
    expect(body).toMatch(/require_strong_session\(\)/i);
    // The owner goes in the WHERE of the FOR UPDATE: someone who is not the owner
    // neither locks another person's row nor finds out whether the id exists
    // (review of #507, D7).
    expect(body).toMatch(/where\s+id\s*=\s*p_course_id\s+and\s+owner_id\s*=\s*v_uid\s+for\s+update/i);
    expect(body).not.toMatch(/Only the course owner can delete it/);
  });

  // Wave G2b: a teacher post and a pending invite blocked the DELETE (FK with no
  // cascade), and a subscription did not count as a buyer.
  it("locks the row, counts subscriptions and cleans up the children before deleting", () => {
    expect(body).toMatch(/for\s+update/i);
    expect(body).toMatch(/from\s+public\.course_subscriptions/i);
    expect(body).toMatch(/v_subscriptions\s*=\s*0/i);

    const cleanup = body.search(/clear_course_for_delete\(/i);
    const deletion = body.search(/delete\s+from\s+public\.courses/i);
    expect(cleanup, "the delete no longer cleans up the children without a cascade").toBeGreaterThan(-1);
    expect(cleanup < deletion, "the cleanup of the children has to come before the delete").toBe(true);
  });
});

describe("delete_course_as_admin — the admin deletes through the same path", () => {
  const body = effectiveDefinition("delete_course_as_admin");

  it("second factor, admin only, and refuses a course with a buyer", () => {
    expect(body).toMatch(/require_strong_session\(\)/i);
    expect(body).toMatch(/is_admin\(\)/i);
    expect(body).toMatch(/from\s+public\.enrollments\s+where\s+course_id/i);
    expect(body).toMatch(/from\s+public\.orders\s+where\s+course_id/i);
    expect(body).toMatch(/from\s+public\.course_subscriptions/i);
  });

  it("cleans up the children without a cascade before deleting", () => {
    const cleanup = body.search(/clear_course_for_delete\(/i);
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup < body.search(/delete\s+from\s+public\.courses/i)).toBe(true);
  });
});

describe("course_deletions — the cleanup queue is born together with the DELETE", () => {
  // After the DELETE, course_assets goes away in a cascade and takes the only
  // list of the Bunny videos with it. The queue has to be written BEFORE, in the
  // same transaction.
  it("a BEFORE DELETE trigger on courses writes the queue with the videos", () => {
    const gatilho = effectiveDefinition("course_deletions_record");
    expect(gatilho).toMatch(/insert\s+into\s+public\.course_deletions/i);
    expect(gatilho).toMatch(/bunny_video_id/i);
    expect(migrationsText()).toMatch(
      /before\s+delete\s+on\s+public\.courses[\s\S]{0,80}course_deletions_record\(\)/i,
    );
  });

  it("the client does not call the children cleanup or the file list", () => {
    const all = migrationsText();
    expect(all).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.clear_course_for_delete\(text\)\s+from\s+public,\s*anon,\s*authenticated/i,
    );
    expect(all).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.course_storage_objects_for_cleanup\(text\)\s+from\s+public,\s*anon,\s*authenticated/i,
    );
  });

  it("the file list only matches the exact folder of the course, with the trailing slash", () => {
    const list = effectiveDefinition("course_storage_objects_for_cleanup");
    expect(list).toMatch(/is_service_role\(\)/);
    expect(list).toMatch(/'courses\/'\s*\|\|\s*p_course_id\s*\|\|\s*'\/'/);
    expect(list).toMatch(/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\*\$/);
    expect(list).toMatch(/Course id is in use again/);
  });

  // Review of #507: hand-picked id, borrowed file, video re-checked.
  it("the list only returns what was born while the course existed, from the pending queue, and flags what another row uses", () => {
    const list = effectiveDefinition("course_storage_objects_for_cleanup");
    expect(list).toMatch(/v_job\.status\s*<>\s*'pending'/);
    expect(list).toMatch(/o\.created_at\s*<=\s*v_job\.requested_at/);
    expect(list).toMatch(/o\.created_at\s*>=\s*v_job\.course_created_at/);
    expect(list).toMatch(/course_cleanup_references\(/);
    expect(list).toMatch(/in_use\s+boolean/i);
  });

  it("a video is only removed with a pending queue, an id with no course and nobody referencing it", () => {
    const video = effectiveDefinition("course_cleanup_video_deletable");
    expect(video).toMatch(/is_service_role\(\)/);
    expect(video).toMatch(/d\.status\s*=\s*'pending'/);
    expect(video).toMatch(/not\s+exists\s*\(select\s+1\s+from\s+public\.courses/i);
    expect(video).toMatch(/not\s+exists\s*\(select\s+1\s+from\s+public\.course_cleanup_references\(p_video_id\)\)/i);
  });

  // Third round: for the client the id stays reserved forever (any status), and
  // the trigger is AFTER (it runs after RLS: no oracle for the queue).
  it("the client never creates or renames a course to an id that went through the queue", () => {
    const gatilho = effectiveDefinition("courses_refuse_id_being_deleted");
    expect(gatilho).toMatch(/auth\.role\(\)\s*\)\s*,\s*''\s*\)\s+in\s*\(\s*'anon'\s*,\s*'authenticated'\s*\)/i);
    expect(gatilho).toMatch(/exists\s*\(select\s+1\s+from\s+public\.course_deletions\s+d\s+where\s+d\.course_id\s*=\s*new\.id\)/i);
    expect(gatilho).not.toMatch(/status/i);
    const migrations = migrationsText();
    expect(migrations).toMatch(
      /after\s+insert\s+or\s+update\s+of\s+id\s+on\s+public\.courses[\s\S]{0,80}courses_refuse_id_being_deleted\(\)/i,
    );
    expect(migrations).not.toMatch(
      /before\s+insert\s+or\s+update\s+of\s+id\s+on\s+public\.courses[\s\S]{0,80}courses_refuse_id_being_deleted\(\)/i,
    );
  });

  it("the badge only shows what is still in the queue (failed and cancelled do not stay forever)", () => {
    expect(effectiveDefinition("list_my_courses_being_deleted")).toMatch(/d\.status\s*=\s*'pending'/);
  });

  it("the old delete_teacher_course_draft door is no longer the client's", () => {
    expect(migrationsText()).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.delete_teacher_course_draft\(text\)\s+from\s+public,\s*anon,\s*authenticated/i,
    );
  });
});

describe("courses_delete_owner — the table must not be the back door", () => {
  // 'inactive' also became the ARCHIVED state, that is, the state of a course
  // that HAS a learner. Without the condition below, an authenticated PostgREST
  // client deletes through the table what the RPC refuses to delete.
  const body = effectivePolicy("courses_delete_owner");

  it("refuses DELETE of a course with an enrollment or an order", () => {
    expect(body).toMatch(/not\s+exists\s*\([\s\S]*public\.enrollments/i);
    expect(body).toMatch(/not\s+exists\s*\([\s\S]*public\.orders/i);
  });

  it("still requires the second factor", () => {
    // Recreating the policy from scratch is the classic way to lose the gate that
    // 20260902120000 installed.
    expect(body).toMatch(/session_is_strong\(\)/);
  });
});

describe("archiving preserves access for those who bought", () => {
  // This is the promise of the dialog: "everyone who bought it keeps full access".
  // It only holds because the two content doors look at the ENROLLMENT, never at
  // the course status. The day someone adds `c.status = 'published'` to one of
  // them, archiving starts cutting off access for those who paid.
  it.each(["course_assets_select", "course_content_select"])(
    "%s does not look at the course status",
    (entryName) => {
      const body = effectivePolicy(entryName);

      expect(body).toMatch(/enrollments/i);
      expect(
        /c\.status|courses\.status/i.test(body),
        `${entryName} started filtering by course status: archiving stops being `
          + "reversible and knocks out the learner who already paid",
      ).toBe(false);
    },
  );
});

/**
 * Text of all the migrations, in order, for assertions that are not about ONE
 * function — here, whether the cleanup job is actually scheduled.
 */
function migrationsText(): string {
  const dir = "supabase/migrations";
  return readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(ROOT, dir, file), "utf8"))
    .join("\n");
}

describe("purge_stale_rate_limits — the rate_limits table has a ceiling", () => {
  // The bug (DB-02): enforce_rate_limit inserts a row for every never-seen key
  // and nothing deleted them — the oldest in production was from 07/01. Half of
  // the keys come from outside (hash of the anonymous visitor's IP), so each new
  // address was a row forever: anti-abuse as a disk-filling primitive.
  const body = effectiveDefinition("purge_stale_rate_limits");

  it("deletes only what is outside any window in use", () => {
    expect(body).toMatch(/delete from public\.rate_limits/i);
    // 2 days > 24h, the largest window (daily ceiling of the advisor and the
    // assistant). Shortening this would delete buckets still counting and loosen
    // a limit.
    expect(body).toMatch(/updated_at\s*<\s*now\(\)\s*-\s*interval\s*'2 days'/i);
  });

  it("is scheduled in pg_cron instead of depending on someone remembering", () => {
    expect(migrationsText()).toMatch(
      /cron\.schedule\(\s*'purge-stale-rate-limits'[\s\S]{0,120}purge_stale_rate_limits\(\)/,
    );
  });
});

describe("claim_custom_domain — the domain quota is atomic", () => {
  // The bug (A-27): the function counted the owner's domains and inserted
  // without locking anything in between. Under READ COMMITTED, two simultaneous
  // calls read the same count, both passed the quota and both inserted — a
  // teacher on starter (quota 1) ended up with N domains for the price of 1,
  // each one attached to the platform's Vercel project. The route says it
  // delegated the quota to SQL precisely to avoid this race; it had only been
  // moved elsewhere.
  const body = effectiveDefinition("claim_custom_domain");
  const locksTheOwner = /from\s+public\.users\s+where\s+uid\s*=\s*v_uid\s+for\s+update/i;

  it("locks the owner's row in users before counting their domains", () => {
    expect(
      body,
      "the plan SELECT is back to having no `for update`: two simultaneous "
        + "claims from the same teacher both get past the quota",
    ).toMatch(locksTheOwner);

    // The order is part of the rule: a lock after the count serializes nothing.
    expect(body.search(locksTheOwner)).toBeLessThan(body.search(/count\(\*\)/));
  });

  it("the quota is still checked and enforced here, not in the route", () => {
    expect(body).toMatch(/v_used\s*>=\s*v_limit/);
    expect(body).toMatch(/insert into public\.custom_domains/i);
  });
});

/**
 * Last definition of a POLICY in the migration chain.
 *
 * Same logic as `definicaoEfetiva`, for the other kind of object: `create
 * policy` creates it, `alter policy` redefines it, and the last one wins. A
 * policy expression contains no semicolon, so the statement runs from
 * `policy <name> on` up to the next `;`.
 */
function effectivePolicy(policyName: string): string {
  const dir = "supabase/migrations";
  const marcador = new RegExp(String.raw`\bpolicy\s+${policyName}\s+on\b`, "i");
  const files = readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  let last: string | null = null;

  for (const file of files) {
    const text = readFileSync(join(ROOT, dir, file), "utf8");
    let position = text.search(marcador);

    while (position !== -1) {
      const end = text.indexOf(";", position);
      last = text.slice(position, end === -1 ? undefined : end);

      const resto = text.slice(position + 1);
      const proxima = resto.search(marcador);
      position = proxima === -1 ? -1 : position + 1 + proxima;
    }
  }

  expect(last, `no migration defines the policy ${policyName}`).not.toBeNull();
  return last as string;
}

describe("session_is_strong — RLS now requires the second factor", () => {
  // The hole (A-17, leftover accepted by PR #146): the second-factor gate lived
  // only on the screen and in createSupabaseServerClient. An aal1 token for an
  // account with TOTP could still read and write through PostgREST directly —
  // with the anon key, which is public — everything the policies allow for
  // auth.uid(). No policy in this database looked at the AAL: `grep -rin aal
  // supabase/migrations` returned zero lines.
  const body = effectiveDefinition("session_is_strong");

  it("decides by account: someone with no verified factor changes nothing", () => {
    expect(body).toMatch(/auth\.mfa_factors/i);
    expect(body).toMatch(/status\s*=\s*'verified'/i);
    expect(
      body,
      "the function has to let through anyone who has NO factor (not exists), otherwise it "
        + "locks the platform for everyone who does not use a second factor",
    ).toMatch(/not\s+exists/i);
  });

  it("a strong session is aal2 read from the token, not an app flag", () => {
    expect(body).toMatch(/auth\.jwt\(\)\s*->>\s*'aal'/i);
    expect(body).toMatch(/'aal2'/);
  });

  it("is security definer with a fixed search_path", () => {
    // Without definer it cannot read auth.mfa_factors; with an open search_path, a
    // schema on the caller's path hijacks what it queries.
    expect(body).toMatch(/security\s+definer/i);
    expect(body).toMatch(/set\s+search_path\s*=/i);
  });

  it("anon can still execute, otherwise public reads abort with 42501", () => {
    // Postgres evaluates a policy expression with the privileges of the current
    // role, and every policy in this database is `TO public` — so it is also
    // evaluated for anon. That was the incident of
    // 20260901120000_restore_anon_execute_on_rls_predicates. For anon the function
    // answers TRUE and the owner predicate keeps filtering: granting gives no
    // power, revoking closes the catalog.
    expect(migrationsText()).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.session_is_strong\(\)\s+to\s+[^;]*\banon\b/i,
    );
  });
});

describe("the policies the second factor now protects", () => {
  // The list is the contract. If someone rewrites one of these without the gate,
  // the red shows up here — and not on the day the TOTP account is emptied out
  // by an aal1 token.
  const protegidas = [
    "courses_insert_owner",
    "courses_update_owner",
    "courses_delete_owner",
    "course_lesson_content_insert_owner",
    "course_lesson_content_update_owner",
    "course_lesson_content_delete",
    "course_assets_insert",
    "course_assets_update_owner",
    "course_assets_delete_owner",
    "users_update_self",
    "custom_domains_select_owner",
    "payout_ledger_owner_sel",
    "payout_ledger_teacher_read",
    "orders_owner_sel",
    "orders_teacher_read",
    "payments_owner_sel",
    "enrollments_select_owner",
    "lesson_comments_insert",
  ];

  it.each(protegidas)("%s requires the strong session", (entryName) => {
    expect(
      effectivePolicy(entryName),
      `${entryName} went back to deciding only by auth.uid(): an aal1 token for an account with `
        + "TOTP gets through it via PostgREST directly",
    ).toMatch(/session_is_strong\(\)/);
  });

  it("the public catalog read stays outside the gate", () => {
    // A gate on a public read policy kills the entire acquisition funnel.
    for (const publica of ["courses_select_public", "course_landings_select_public"]) {
      expect(effectivePolicy(publica)).not.toMatch(/session_is_strong/);
    }
  });
});

describe("Ops control room — reading a person requires an admin with 2FA and writes nothing", () => {
  // The list and the dossier show personal and financial data for any account.
  // The gate is the one from the account control in #326: active admin AND aal2.
  // Swapping it for require_strong_session would let an admin with no enrolled
  // factor read everything.
  for (const entryName of ["admin_search_users", "admin_get_user_dossier"]) {
    const body = effectiveDefinition(entryName);

    it(`${entryName}: security definer with a fixed search_path`, () => {
      expect(body).toMatch(/security\s+definer/i);
      expect(body).toMatch(/set\s+search_path\s+to\s+'public',\s*'pg_temp'/i);
    });

    it(`${entryName}: refuses anyone who is not an admin or has no aal2`, () => {
      expect(body).toMatch(/public\.is_admin\(\)/i);
      expect(body).toMatch(/'aal2'/);
      expect(body).toMatch(/OPS_ADMIN_MFA_REQUIRED/);
    });

    it(`${entryName}: read only`, () => {
      expect(body).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/i);
    });
  }

  it("the dossier shows the count and date of a private conversation, never the text", () => {
    // advisor_messages.content and course_messages.body are private conversation;
    // course_lesson_content is the paid course. The operator sees how much and when.
    const body = effectiveDefinition("admin_get_user_dossier");
    expect(body).not.toMatch(/\.content\b/);
    expect(body).not.toMatch(/\bm\.body\b/);
    expect(body).not.toMatch(/course_lesson_content/);
  });
});
