import Stripe from "stripe";

import { sanitizeStripeSecret } from "@/lib/payments/rules";

// Server-only Stripe client factory. Ports getStripeClient() from the Firebase
// functions to Next.js Route Handlers. The secret lives ONLY in STRIPE_SECRET_KEY
// (server env, never NEXT_PUBLIC) and must never reach the browser — the
// `typeof window` guard enforces that at runtime (Next also never inlines a
// non-NEXT_PUBLIC env into the client bundle, so the value is undefined there).
//
// ponytail: no explicit apiVersion — use the installed SDK's pinned default
// (stripe@22 → 2026-04-22.dahlia). The constructor apiVersion only sets the
// Stripe-Version header on OUTBOUND calls; webhook payload shape comes from the
// event's own creation version, which resolveInvoicePaymentIntentId already
// handles defensively across Basil+ changes.

/**
 * Payments are founder-gated: STRIPE_SECRET_KEY is not set until the owner
 * enables Stripe. Callers catch this to return a clean "payments not configured"
 * response instead of an opaque 500 — mirroring the Firebase HttpsError copy.
 */
export class StripeConfigError extends Error {
  readonly reason: "missing" | "malformed";

  constructor(reason: "missing" | "malformed") {
    super(
      reason === "missing"
        ? "Stripe secret key is not configured."
        : "Stripe secret key is malformed (it contains spaces or line breaks). " +
            "Re-set STRIPE_SECRET_KEY as a single line with no extra characters.",
    );
    this.name = "StripeConfigError";
    this.reason = reason;
  }
}

let cached: { key: string; client: Stripe } | null = null;
// ponytail: unbounded Map is fine — one entry per connected account that ever
// sells with installments on, and the process is short-lived on Vercel.
const cachedAccountCountry = new Map<string, string>();

/** Whether a usable Stripe secret is configured (drives dormant-state gates). */
export function isStripeConfigured(): boolean {
  return sanitizeStripeSecret(process.env.STRIPE_SECRET_KEY).ok;
}

/**
 * Returns a cached Stripe client, re-created only when the key changes. Throws
 * StripeConfigError when the secret is missing or malformed — the sanitize step
 * trims a stray trailing newline that would otherwise poison the Authorization
 * header (the ERR_INVALID_CHAR footgun; see rules.ts).
 */
export function getStripeClient(): Stripe {
  if (typeof window !== "undefined") {
    throw new Error("The Stripe client must never run in the browser.");
  }

  const result = sanitizeStripeSecret(process.env.STRIPE_SECRET_KEY);
  if (!result.ok) {
    throw new StripeConfigError(result.reason);
  }

  if (cached?.key !== result.key) {
    cachedAccountCountry.clear();
    cached = {
      key: result.key,
      client: new Stripe(result.key),
    };
  }

  return cached.client;
}

/**
 * Two-letter country of the Stripe account a charge will be created on.
 *
 * Pass the TEACHER's connected account id. Under direct charges the charge is
 * created on their account, so their country — not the platform's — is what
 * Stripe checks for card-installment eligibility. Reading the platform account
 * here would answer for the wrong merchant: a Mexican teacher would be denied
 * installments because SkillsetMind is a US account, and a US teacher under a
 * Mexican platform would be offered installments Stripe then rejects.
 *
 * Returns null when Stripe cannot be reached — callers treat that as "not
 * eligible", which fails closed.
 */
export async function getStripeAccountCountry(
  stripe: Stripe,
  accountId: string,
): Promise<string | null> {
  const cachedCountry = cachedAccountCountry.get(accountId);
  if (cachedCountry) {
    return cachedCountry;
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const country = account.country?.trim().toUpperCase() || null;
    if (country) cachedAccountCountry.set(accountId, country);
    return country;
  } catch {
    return null;
  }
}
