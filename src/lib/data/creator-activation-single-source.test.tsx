import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isActivationRequiredError } from "@/domain/creator-verification";

/**
 * The activation paywall has exactly one definition: the SECURITY DEFINER
 * predicate `creator_activation_blocked()`. It folds together three things —
 * the require_activation_fee flag, the admin exemption, and whether the fee is
 * already paid. The courses trigger uses it, assertCreatorActivated() uses it,
 * and fetchCreatorActivationBlocked() uses it.
 *
 * The bug this guards against: re-deriving the answer in a component from the
 * raw flag plus a profile field. That copy has no admin exemption, so the UI
 * paywalls the platform owner while every server route waves them through —
 * a half-open paywall that only shows up once the flag is flipped on.
 */
const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("creator activation predicate", () => {
  const files = walk(SRC).filter((f) => !f.includes(".test."));

  it("is never re-derived from the raw platform flag outside the migration", () => {
    // Match the quoted key, not the bare word — prose that merely names the
    // flag (this file, the doc comment on fetchCreatorActivationBlocked) is
    // not a read of it. The checkout route is the one legitimate reader: it
    // decides whether the fee is on sale at all, before any user exists to
    // exempt. Anywhere else, reading this key is the first half of a
    // hand-rolled copy of the predicate.
    const allowed = [
      join("app", "api", "payments", "activation", "checkout", "route.ts"),
    ];
    const offenders = files.filter(
      (f) =>
        readFileSync(f, "utf8").includes('"require_activation_fee"')
        && !allowed.some((tail) => f.endsWith(tail)),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("recognises every sentence the gate actually raises", () => {
    // The gate refuses in words, and the UI decides what to show by matching
    // those words. That coupling is invisible: reword the migration and every
    // screen silently falls back to "Please try again". So harvest the real
    // sentences from the places that raise them and assert the matcher still
    // catches each one.
    const sources = [
      join(
        process.cwd(),
        "supabase",
        "migrations",
        "20260810030000_creator_activation_gate_earlier.sql",
      ),
      join(SRC, "lib", "payments", "server", "auth.ts"),
      join(SRC, "lib", "data", "course-assets.ts"),
    ];
    const raised = sources.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/["'](Pay the one-time[^"']+)["']/g)]
        .map((match) => match[1]),
    );

    expect(raised.length).toBeGreaterThanOrEqual(3);
    for (const sentence of raised) {
      expect(isActivationRequiredError(sentence)).toBe(true);
    }
  });

  it("is read through the shared RPC wherever the UI gates on it", () => {
    const source = readFileSync(
      join(SRC, "lib", "data", "creator-verification.ts"),
      "utf8",
    );
    expect(source).toContain('supabase.rpc("creator_activation_blocked")');
  });
});
