import type Stripe from "stripe";

import { planById, hasRealStripePriceIds } from "@/data/plans";
import type { PlanBillingCycle, PlanId } from "@/data/plans";
import { normalizeSkillsetCurrency } from "@/lib/payments/currencies";
import { PaymentError } from "@/lib/payments/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

// Server-only Stripe/data helpers shared by the payment Route Handlers that
// replace the Firebase callables. Ports the shared helpers from
// functions/src/index.ts (createFreshConnectedAccount, normalizeCoursePrice,
// getOrCreateCourseSubscriptionPrice, getOrCreateBillingStripeCustomer,
// resolvePriceId, courseSubscriptionInterval) onto the service-role Supabase
// client. Firestore doc reads/writes become table reads/writes on snake_case
// columns; the Stripe calls are byte-for-byte identical to the originals.

export type CourseRow = Database["public"]["Tables"]["courses"]["Row"];
export type UserRow = Database["public"]["Tables"]["users"]["Row"];

/** Cached recurring-Price snapshot stored on courses.stripe_subscription_price. */
type CourseSubscriptionPriceCache = {
  priceId?: string;
  amountMinor?: number;
  currency?: string;
  interval?: "month" | "year";
};

/** Reads a course row by id via the service-role client (or null if absent). */
export async function getCourseRow(courseId: string): Promise<CourseRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load course ${courseId}: ${error.message}`);
  }
  return data;
}

/** Reads a user row by uid via the service-role client (or null if absent). */
export async function getUserRow(uid: string): Promise<UserRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("uid", uid)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load user ${uid}: ${error.message}`);
  }
  return data;
}

/**
 * Recurring interval for a course's payment type, or null for one-time/free
 * courses. Ports courseSubscriptionInterval(): subscription_monthly -> "month",
 * subscription_yearly -> "year".
 */
export function courseSubscriptionInterval(
  paymentType: string | null | undefined,
): "month" | "year" | null {
  if (paymentType === "subscription_monthly") return "month";
  if (paymentType === "subscription_yearly") return "year";
  return null;
}

/**
 * Validates a course has a paid checkout price and returns the amount + a
 * lowercase Stripe currency. Throws PaymentError (surfaced verbatim) when the
 * course has no positive price — mirrors the failed-precondition HttpsError.
 */
export function normalizeCoursePrice(course: CourseRow): {
  amountMinor: number;
  currency: string;
} {
  const amountMinor = course.price_amount_minor;

  if (typeof amountMinor !== "number" || amountMinor <= 0) {
    throw new PaymentError(
      "This course does not have a paid checkout price yet.",
    );
  }

  return {
    amountMinor,
    currency: normalizeSkillsetCurrency(course.currency).toLowerCase(),
  };
}

/**
 * Mints a fresh Stripe Express connected account and persists it on the user
 * row (overwriting any existing stripe_connected_account_id). Shared by both
 * onboarding routes for the initial-create and self-heal-recreate paths, so an
 * orphaned id is replaced in exactly one place. Fund-safe to overwrite:
 * transfers/refunds read a FROZEN teacher_stripe_connected_account_id snapshot
 * captured at payment-capture time, never this live field.
 */
export async function createFreshConnectedAccount(params: {
  uid: string;
  email: string | undefined;
  stripe: Stripe;
}): Promise<string> {
  const { uid, email, stripe } = params;

  const account = await stripe.accounts.create({
    type: "express",
    email,
    business_type: "individual",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { skillsetUserId: uid },
  });

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("users")
    .update({
      stripe_connected_account_id: account.id,
      stripe_connect_status: "created",
      stripe_connect_charges_enabled: Boolean(account.charges_enabled),
      stripe_connect_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_connect_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("uid", uid);
  if (error) {
    throw new Error(`Failed to persist connected account: ${error.message}`);
  }

  return account.id;
}

/**
 * Returns a recurring Stripe Price id for a course subscription, creating and
 * caching one on the course row on first use. Prices are immutable in Stripe, so
 * a change to the course price/cadence mints a fresh Price and re-caches it (a
 * stale cache that no longer matches amount/currency/interval is ignored). The
 * Price lives on the PLATFORM account: the subscription charges the platform
 * Customer and the teacher payout is a held Transfer released by the cron —
 * identical economics to the one-time rail.
 */
export async function getOrCreateCourseSubscriptionPrice(
  stripe: Stripe,
  course: CourseRow,
  courseId: string,
  amountMinor: number,
  currency: string,
  interval: "month" | "year",
): Promise<string> {
  const cached = (course.stripe_subscription_price ??
    null) as CourseSubscriptionPriceCache | null;
  if (
    cached
    && cached.priceId
    && cached.amountMinor === amountMinor
    && cached.currency === currency
    && cached.interval === interval
  ) {
    return cached.priceId;
  }

  const price = await stripe.prices.create({
    currency,
    unit_amount: amountMinor,
    recurring: { interval },
    product_data: {
      name: course.title,
      metadata: { courseId, ownerId: course.owner_id },
    },
    metadata: {
      courseId,
      ownerId: course.owner_id,
      kind: "course_subscription",
    },
  });

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("courses")
    .update({
      stripe_subscription_price: {
        priceId: price.id,
        amountMinor,
        currency,
        interval,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", courseId);
  if (error) {
    throw new Error(`Failed to cache subscription price: ${error.message}`);
  }

  return price.id;
}

/**
 * Returns the user's Stripe Customer ID, creating one on first use and
 * persisting it on the user row so future sessions reuse it. Without a stable
 * customer record, every checkout would create a duplicate customer in Stripe.
 */
export async function getOrCreateBillingStripeCustomer(
  stripe: Stripe,
  uid: string,
  emailFromAuth?: string | null,
): Promise<string> {
  const profile = await getUserRow(uid);

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: profile?.email ?? emailFromAuth ?? undefined,
    name: profile?.display_name ?? undefined,
    metadata: { uid },
  });

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("users")
    .update({
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("uid", uid);
  if (error) {
    throw new Error(`Failed to persist Stripe customer: ${error.message}`);
  }

  return customer.id;
}

/**
 * Resolves the real Stripe Price id for a paid plan + cycle from the single
 * source of truth (src/data/plans.ts). Throws PaymentError when the plan has no
 * configured Price or still ships placeholder ids — the caller maps that to the
 * "billing not configured" state instead of an opaque Stripe error.
 */
export function resolvePriceId(
  planId: Exclude<PlanId, "free">,
  cycle: PlanBillingCycle,
): string {
  const plan = planById(planId);
  if (!plan.stripePriceIds || !hasRealStripePriceIds(plan)) {
    throw new PaymentError(
      `Stripe Price for plan ${planId} (${cycle}) is not configured yet.`,
      503,
      "payments_not_configured",
    );
  }
  return cycle === "monthly"
    ? plan.stripePriceIds.monthlyId
    : plan.stripePriceIds.yearlyId;
}
