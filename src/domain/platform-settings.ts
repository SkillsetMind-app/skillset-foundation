/**
 * platform_settings.value is `jsonb`, and the flag it holds has TWO readers
 * with different ideas of what "on" looks like:
 *
 *   SQL  (creator_activation_blocked, migration 20260810030000):
 *          (ps.value #>> '{}')::boolean
 *        `#>>` extracts TEXT, so a jsonb string "true" yields text `true`,
 *        which casts to boolean true. The gate turns ON.
 *
 *   TypeScript (this file's callers):
 *        supabase-js parses jsonb, so a jsonb string "true" arrives as the JS
 *        string "true". A strict `=== true` says the gate is OFF.
 *
 * That divergence is a total creator lockout waiting to happen. The flag is
 * flipped by hand in SQL; write `'"true"'::jsonb` instead of `'true'::jsonb`
 * and the courses trigger blocks every creator from building while
 * /api/payments/activation/checkout answers 409 activation_not_required —
 * nobody can create a course and nobody can pay to unblock themselves.
 *
 * So TS matches SQL's tolerance instead of being stricter than it, across the
 * FULL set Postgres accepts — not just "true". Verified against production:
 * "TRUE", "t", "y", "yes", "on", "1" and even " true " (padded) all cast to
 * boolean true, because ::boolean trims and is case-insensitive. Six ways to
 * write the lockout, not one.
 *
 * Anything Postgres does NOT recognise stays off here: an unset row, a null,
 * "maybe". Postgres would raise on that text rather than return false, and an
 * exception is not something this predicate can mirror — off is the safe read,
 * since a gate that fails closed-to-open is a paywall, not a lockout.
 */
const POSTGRES_TRUE = new Set(["t", "true", "y", "yes", "on", "1"]);

export function isPlatformFlagOn(value: unknown): boolean {
  if (value === true) return true;
  // A jsonb number 1 arrives as JS 1, and `('1'::jsonb #>> '{}')::boolean` is
  // true in SQL — so it counts, same as the string.
  if (value === 1) return true;
  return typeof value === "string"
    && POSTGRES_TRUE.has(value.trim().toLowerCase());
}
