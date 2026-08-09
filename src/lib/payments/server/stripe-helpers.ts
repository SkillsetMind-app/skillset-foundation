import type Stripe from "stripe";

import { planById, hasRealStripePriceIds } from "@/data/plans";
import type { PlanBillingCycle, PlanId } from "@/data/plans";
import type {
  ProductOffer,
  ProductPriceSelection,
} from "@/domain/product-pricing";
import { resolveCoursePrice } from "@/domain/product-pricing";
import type { TeacherCoursePaymentType } from "@/domain/teacher-course";
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
  /**
   * Connected account the price was minted on. Prices are account-scoped under
   * direct charges, so a cache entry from another account must not be reused.
   * Absent on rows cached before the direct-charge pivot — those miss the cache
   * and are re-created on the connected account, which is the desired repair.
   */
  accountId?: string;
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

type StripeAccountOptions = { stripeAccount: string } | undefined;

type SubscriptionCancellationClient = {
  subscriptions: {
    retrieve(
      subscriptionId: string,
      params?: Record<string, never>,
      options?: StripeAccountOptions,
    ): Promise<{ status: string }>;
    cancel(
      subscriptionId: string,
      params?: Record<string, never>,
      options?: StripeAccountOptions,
    ): Promise<unknown>;
  };
};

/**
 * Cancels recurring billing once while remaining safe on request retries.
 *
 * Course subscriptions are created as DIRECT CHARGES, so the Subscription
 * object is owned by the teacher's connected account: without the account
 * header both calls 404 and a refunded learner would keep getting billed.
 * `connectedAccountId` is nullable only for legacy platform-owned subscriptions
 * predating the direct-charge pivot.
 */
export async function ensureCourseSubscriptionCanceled(
  stripe: SubscriptionCancellationClient,
  subscriptionId: string,
  connectedAccountId?: string | null,
): Promise<void> {
  const options: StripeAccountOptions = connectedAccountId
    ? { stripeAccount: connectedAccountId }
    : undefined;
  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId,
    {},
    options,
  );
  if (subscription.status === "canceled") return;
  await stripe.subscriptions.cancel(subscriptionId, {}, options);
}

/**
 * Validates a course has a paid checkout price and returns the amount + a
 * lowercase Stripe currency. Dual-reads optional offer/price packages first
 * (`resolveCoursePrice`); falls back to legacy courses.price_amount_minor.
 * Throws PaymentError when no positive price is available.
 */
export function normalizeCoursePrice(
  course: CourseRow,
  offers: ProductOffer[] = [],
  selection: ProductPriceSelection = {},
): {
  amountMinor: number;
  currency: string;
  paymentType: string | null;
  source: "legacy" | "offer";
  offerId?: string;
  priceId?: string;
  stripePriceId?: string | null;
} {
  const resolved = resolveCoursePrice(
    {
      id: course.id,
      priceAmountMinor: course.price_amount_minor ?? undefined,
      currency: course.currency ?? undefined,
      paymentType: (course.payment_type ?? undefined) as
        | TeacherCoursePaymentType
        | undefined,
    },
    offers,
    selection,
  );

  if (!resolved || resolved.amountMinor <= 0) {
    throw new PaymentError(
      "This course does not have a paid checkout price yet.",
    );
  }

  return {
    amountMinor: resolved.amountMinor,
    currency: normalizeSkillsetCurrency(resolved.currency).toLowerCase(),
    paymentType: resolved.paymentType ?? course.payment_type ?? null,
    source: resolved.source,
    offerId: resolved.offerId,
    priceId: resolved.priceId,
    stripePriceId: resolved.stripePriceId,
  };
}

/**
 * Load product offers/prices for dual-read checkout.
 * Returns [] only when no packages are configured. Query failures are fatal so
 * checkout never silently charges a legacy price after an offer read failed.
 */
export async function loadCourseProductOffers(
  courseId: string,
): Promise<ProductOffer[]> {
  const supabase = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: offerRows, error: offerError } = await db
    .from("product_offers")
    .select("id,course_id,name,is_default,active,public_code")
    .eq("course_id", courseId)
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (offerError) {
    throw new Error(`Failed to load course offers: ${offerError.message}`);
  }
  if (!Array.isArray(offerRows) || offerRows.length === 0) {
    return [];
  }

  const offers: ProductOffer[] = [];
  for (const row of offerRows as Array<Record<string, unknown>>) {
    const offerId = String(row.id ?? "");
    if (!offerId) continue;
    const { data: priceRows, error: priceError } = await db
      .from("product_prices")
      .select(
        "id,offer_id,amount_minor,currency,payment_type,stripe_price_id,active",
      )
      .eq("offer_id", offerId)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (priceError) {
      throw new Error(`Failed to load prices for offer ${offerId}: ${priceError.message}`);
    }
    const prices: ProductOffer["prices"] = (
      (priceRows as Array<Record<string, unknown>> | null) ?? []
    ).map((price) => ({
      id: String(price.id ?? ""),
      offerId,
      amountMinor: Number(price.amount_minor ?? 0),
      currency: String(price.currency ?? "USD"),
      paymentType: String(
        price.payment_type ?? "one_time",
      ) as TeacherCoursePaymentType,
      stripePriceId:
        typeof price.stripe_price_id === "string" ? price.stripe_price_id : null,
      active: price.active !== false,
    }));
    offers.push({
      id: offerId,
      courseId: String(row.course_id ?? courseId),
      name: String(row.name ?? "Offer"),
      publicCode:
        typeof row.public_code === "string" ? row.public_code : null,
      isDefault: Boolean(row.is_default),
      active: row.active !== false,
      prices,
    });
  }
  return offers;
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
/**
 * Get (or create) the recurring Price backing a subscription course.
 *
 * Under DIRECT CHARGES the Price must live on the TEACHER's connected account —
 * a Checkout Session created with `{ stripeAccount }` can only reference objects
 * owned by that account, so a platform-owned price id fails with
 * "No such price". The cache is therefore keyed by account id as well: if a
 * teacher ever reconnects under a different Stripe account, the stale price is
 * ignored and a fresh one is minted on the new account instead of 500-ing every
 * subscription checkout.
 */
export async function getOrCreateCourseSubscriptionPrice(
  stripe: Stripe,
  course: CourseRow,
  courseId: string,
  amountMinor: number,
  currency: string,
  interval: "month" | "year",
  connectedAccountId: string,
): Promise<string> {
  const cached = (course.stripe_subscription_price ??
    null) as CourseSubscriptionPriceCache | null;
  if (
    cached
    && cached.priceId
    && cached.amountMinor === amountMinor
    && cached.currency === currency
    && cached.interval === interval
    && cached.accountId === connectedAccountId
  ) {
    return cached.priceId;
  }

  const price = await stripe.prices.create(
    {
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
    },
    { stripeAccount: connectedAccountId },
  );

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("courses")
    .update({
      stripe_subscription_price: {
        priceId: price.id,
        amountMinor,
        currency,
        interval,
        accountId: connectedAccountId,
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
 * A Stripe Coupon on the TEACHER's account for an N% discount.
 *
 * Under direct charges the coupon, like the price, has to exist on the
 * connected account — a platform coupon is invisible to a session created with
 * `{ stripeAccount }`. One coupon per (percent, account), keyed by a
 * deterministic id so repeat checkouts reuse it instead of littering the
 * teacher's dashboard.
 *
 * `duration: "once"` is a product decision, not a Stripe default. `course_coupons`
 * has no duration column, so a teacher who types "50% off" has no way to say
 * "first month only" — and a percent-off that repeats forever would halve their
 * MRR for the life of every subscriber. First invoice only is what Hotmart and
 * Eduzz do, and it is the reversible choice.
 * ponytail: add a `duration` column when a teacher actually asks for recurring.
 */
export async function getOrCreateAccountPercentOffCoupon(
  stripe: Stripe,
  percentOff: number,
  connectedAccountId: string,
): Promise<string> {
  const pct = Math.min(90, Math.max(1, Math.floor(percentOff)));
  const couponId = `skillset_pct_${pct}_once`;

  try {
    const existing = await stripe.coupons.retrieve(couponId, undefined, {
      stripeAccount: connectedAccountId,
    });
    // The coupon id is deterministic and the account belongs to the TEACHER, so
    // a teacher can pre-create `skillset_pct_50_once` in their own dashboard
    // with different terms. Reusing it blindly would charge the student
    // something other than the discount the platform recorded and emailed.
    // Trust the id only when the terms match exactly; otherwise fail closed.
    if (existing.percent_off !== pct || existing.duration !== "once") {
      throw new Error(
        `Stripe coupon ${couponId} on account ${connectedAccountId} does not match the platform terms (${pct}% off, once).`,
      );
    }
    return existing.id;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`Stripe coupon ${couponId}`)
    ) {
      throw error;
    }
    // Not on this account yet — create it below.
  }

  try {
    const created = await stripe.coupons.create(
      {
        id: couponId,
        percent_off: pct,
        duration: "once",
        name: `${pct}% off first payment`,
        metadata: { kind: "skillset_course_coupon" },
      },
      { stripeAccount: connectedAccountId },
    );
    return created.id;
  } catch (error) {
    // Two checkouts racing on the same percent: the loser just uses the id.
    if ((error as { code?: string }).code === "resource_already_exists") {
      return couponId;
    }
    throw error;
  }
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
