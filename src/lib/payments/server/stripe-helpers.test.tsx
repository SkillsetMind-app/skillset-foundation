import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  createFreshConnectedAccount,
  ensureCourseSubscriptionCanceled,
  getOrCreateBillingStripeCustomer,
  normalizeCoursePrice,
} from "@/lib/payments/server/stripe-helpers";
import type { ProductOffer } from "@/domain/product-pricing";
import type { CourseRow } from "@/lib/payments/server/stripe-helpers";

const { supabaseQuery } = vi.hoisted(() => {
  // One self-returning object covers both chains the create helpers use:
  // .from().select().eq().maybeSingle() for the profile read, and
  // .from().update().eq() awaited for the write — awaiting a plain
  // non-thenable destructures to { error: undefined }, the same silent
  // success the real driver returns on a zero-error UPDATE.
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    update: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
  });
  return { supabaseQuery: q };
});

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({ from: () => supabaseQuery }),
}));

describe("ensureCourseSubscriptionCanceled", () => {
  it("cancels an active subscription", async () => {
    const retrieve = vi.fn().mockResolvedValue({ status: "active" });
    const cancel = vi.fn().mockResolvedValue({ status: "canceled" });

    await ensureCourseSubscriptionCanceled(
      { subscriptions: { retrieve, cancel } },
      "sub_123",
    );

    expect(retrieve).toHaveBeenCalledWith("sub_123", {}, undefined);
    expect(cancel).toHaveBeenCalledWith("sub_123", {}, undefined);
  });

  it("targets the teacher's connected account when one is given", async () => {
    // Direct charges: the subscription lives on the teacher's account, so a
    // platform-scoped cancel would 404 and the refunded learner would keep
    // being billed.
    const retrieve = vi.fn().mockResolvedValue({ status: "active" });
    const cancel = vi.fn().mockResolvedValue({ status: "canceled" });

    await ensureCourseSubscriptionCanceled(
      { subscriptions: { retrieve, cancel } },
      "sub_123",
      "acct_teacher",
    );

    const options = { stripeAccount: "acct_teacher" };
    expect(retrieve).toHaveBeenCalledWith("sub_123", {}, options);
    expect(cancel).toHaveBeenCalledWith("sub_123", {}, options);
  });

  it("does not cancel twice when a refund request is retried", async () => {
    const retrieve = vi.fn().mockResolvedValue({ status: "canceled" });
    const cancel = vi.fn();

    await ensureCourseSubscriptionCanceled(
      { subscriptions: { retrieve, cancel } },
      "sub_123",
    );

    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("normalizeCoursePrice dual-read", () => {
  const baseCourse = {
    id: "course-1",
    price_amount_minor: 9900,
    currency: "BRL",
    payment_type: "one_time",
  } as CourseRow;

  it("uses legacy columns when no offers are provided", () => {
    const priced = normalizeCoursePrice(baseCourse, []);
    expect(priced.source).toBe("legacy");
    expect(priced.amountMinor).toBe(9900);
    expect(priced.currency).toBe("brl");
    expect(priced.paymentType).toBe("one_time");
  });

  it("prefers offer price over legacy columns", () => {
    const offers: ProductOffer[] = [
      {
        id: "offer-1",
        courseId: "course-1",
        name: "Default",
        isDefault: true,
        prices: [
          {
            id: "price-1",
            offerId: "offer-1",
            amountMinor: 14900,
            currency: "BRL",
            paymentType: "subscription_monthly",
            stripePriceId: "price_abc",
          },
        ],
      },
    ];
    const priced = normalizeCoursePrice(baseCourse, offers);
    expect(priced.source).toBe("offer");
    expect(priced.amountMinor).toBe(14900);
    expect(priced.paymentType).toBe("subscription_monthly");
    expect(priced.stripePriceId).toBe("price_abc");
  });

  it("snapshots the explicitly selected offer and price", () => {
    const offers: ProductOffer[] = [
      {
        id: "offer-default",
        courseId: "course-1",
        name: "Default",
        isDefault: true,
        prices: [
          {
            id: "price-default",
            offerId: "offer-default",
            amountMinor: 14900,
            currency: "BRL",
            paymentType: "one_time",
          },
        ],
      },
      {
        id: "offer-launch",
        courseId: "course-1",
        name: "Launch",
        publicCode: "LAUNCH",
        prices: [
          {
            id: "price-launch",
            offerId: "offer-launch",
            amountMinor: 7900,
            currency: "BRL",
            paymentType: "one_time",
          },
        ],
      },
    ];

    expect(
      normalizeCoursePrice(baseCourse, offers, { publicCode: "launch" }),
    ).toMatchObject({
      amountMinor: 7900,
      offerId: "offer-launch",
      priceId: "price-launch",
    });
  });
});

describe("idempotency keys on first-use creates", () => {
  it("keys the billing customer per user so racing first checkouts collapse", async () => {
    const create = vi.fn().mockResolvedValue({ id: "cus_1" });
    const stripe = { customers: { create } } as unknown as Stripe;

    await getOrCreateBillingStripeCustomer(stripe, "uid_1", "a@b.co");
    await getOrCreateBillingStripeCustomer(stripe, "uid_1", "a@b.co");

    expect(create.mock.calls[0][1].idempotencyKey).toBe("billing_customer_uid_1");
    expect(create.mock.calls[1][1].idempotencyKey).toBe("billing_customer_uid_1");
  });

  it("keys a connect recreate apart from the initial create", async () => {
    // The control. A uid-only key would pass the customer test above, but here
    // it would make the self-heal replay a create from up to 24h earlier and
    // hand back the very orphaned account it is replacing.
    const create = vi.fn().mockResolvedValue({ id: "acct_new" });
    const stripe = { accounts: { create } } as unknown as Stripe;

    await createFreshConnectedAccount({ uid: "uid_1", email: undefined, stripe });
    await createFreshConnectedAccount({
      uid: "uid_1",
      email: undefined,
      stripe,
      replacingAccountId: "acct_orphan",
    });

    expect(create.mock.calls[0][1].idempotencyKey).toBe(
      "connect_account_uid_1_initial",
    );
    expect(create.mock.calls[1][1].idempotencyKey).toBe(
      "connect_account_uid_1_acct_orphan",
    );
  });
});
