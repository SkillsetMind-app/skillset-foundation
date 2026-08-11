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
 * So TS matches SQL's tolerance instead of being stricter than it. Anything
 * that is not recognisably "on" stays off: an unset row, a null, a typo.
 */
export function isPlatformFlagOn(value: unknown): boolean {
  return value === true || value === "true";
}
