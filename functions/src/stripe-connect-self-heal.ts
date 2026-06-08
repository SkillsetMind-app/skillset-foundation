import Stripe from "stripe";

/**
 * Stripe Connect onboarding self-healing.
 *
 * A teacher's stored `stripeConnectedAccountId` becomes "orphaned" when it was
 * minted under a different Stripe platform/key/mode (test vs live, or a key
 * rotation) than the secret the function now uses. Stripe then rejects any
 * operation against that account id with "...not connected to your platform or
 * does not exist", and payout onboarding dead-ends. These helpers detect that
 * precise condition and let the callers mint a fresh account and retry once.
 *
 * Extracted as pure, dependency-injected functions (mirroring payment-rules.ts)
 * so the predicate AND the at-most-once retry control-flow are unit-testable
 * without the Firebase admin SDK or a Stripe client.
 */

const ORPHAN_ACCOUNT_CODES = new Set(["account_invalid", "resource_missing"]);

// Anchored to Stripe's own orphan phrasings — never generic "invalid" text.
const ORPHAN_ACCOUNT_MESSAGE =
  /not connected to your platform|does not exist|No such account/i;

/**
 * CONSERVATIVE orphaned-account detector.
 *
 * Returns true ONLY when Stripe is telling us the *stored connected-account id*
 * is unusable on THIS platform/key/mode (wrong platform, deleted, never
 * existed). It deliberately returns false for connection / API / rate-limit /
 * auth / permission / idempotency errors, because a false positive would
 * discard a VALID account id and mint a duplicate connected account.
 *
 * Gates (each must pass; we never widen on message alone):
 *   1. Must be a Stripe.errors.StripeError at all.
 *   2. Hard-exclude the transient / infra / credential / quota families.
 *   3. Accept on a KNOWN orphan `code` (account_invalid | resource_missing).
 *   4. Message-regex fallback fenced behind StripeInvalidRequestError. NB: on
 *      stripe-node, `error.type` is the CLASS name ("StripeInvalidRequestError")
 *      and the API type lives on `error.rawType` — so we gate on `instanceof`,
 *      which is the reliable check, NOT a string compare against
 *      "invalid_request_error".
 */
export function isOrphanedAccountError(error: unknown): boolean {
  // Gate 1 — only reason about real Stripe SDK errors.
  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }

  // Gate 2 — hard exclusions. Transient / infra / credential / quota failures:
  // the stored account id may be perfectly valid, so NEVER orphan on them.
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeAuthenticationError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeIdempotencyError
  ) {
    return false;
  }

  // Belt-and-suspenders: any retriable status code => bail, even if the error
  // slipped past the class checks above (e.g. a 429 surfaced as a base error).
  if (
    error.statusCode === 429 ||
    error.statusCode === 500 ||
    error.statusCode === 503
  ) {
    return false;
  }

  const code = typeof error.code === "string" ? error.code : "";

  // Gate 3 — authoritative orphan codes Stripe emits for a non-existent /
  // not-on-platform account on accountLinks / accountSessions / accounts.retrieve.
  if (ORPHAN_ACCOUNT_CODES.has(code)) {
    return true;
  }

  // Gate 4 — tight message fallback, fenced behind StripeInvalidRequestError.
  if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
    return false;
  }

  // A card-style decline must never be mistaken for an orphaned account.
  const declineCode = (error as { decline_code?: unknown }).decline_code;
  if (typeof declineCode === "string" && declineCode) {
    return false;
  }

  const message = typeof error.message === "string" ? error.message : "";
  return ORPHAN_ACCOUNT_MESSAGE.test(message);
}

/**
 * Runs a Stripe operation that depends on a stored connected-account id, with
 * AT-MOST-ONCE self-healing.
 *
 * If `runOp` fails because the stored account is orphaned
 * (`isOrphanedAccountError`), `recreateAccount` mints + persists a fresh account
 * and `runOp` is retried exactly once with the new id.
 *
 * The retry runs OUTSIDE the try/catch, so a second orphan error propagates
 * instead of re-entering the heal branch: `recreateAccount` runs at most once
 * per call. No loop, no recursion, no counter. Any non-orphan error — and any
 * error from the single retry — surfaces unchanged for the caller's normalizer.
 *
 * Callers MUST keep their per-user rate-limit gate ABOVE this call so a pathological
 * recreate-every-time scenario is still bounded by the hourly onboarding cap.
 */
export async function runWithOrphanedAccountSelfHeal<T>(params: {
  accountId: string;
  runOp: (accountId: string) => Promise<T>;
  recreateAccount: () => Promise<string>;
  onRecreate?: (staleAccountId: string) => void;
}): Promise<T> {
  const { accountId, runOp, recreateAccount, onRecreate } = params;

  try {
    return await runOp(accountId);
  } catch (error) {
    if (!isOrphanedAccountError(error)) {
      throw error;
    }
    onRecreate?.(accountId);
    const freshAccountId = await recreateAccount();
    // Single retry, deliberately outside the try: a second orphan (or any other
    // error) propagates rather than re-healing — recreateAccount runs once.
    return runOp(freshAccountId);
  }
}
