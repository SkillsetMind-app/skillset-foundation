import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  createFreshConnectedAccount,
  ensureCourseSubscriptionCanceled,
  getOrCreateBillingStripeCustomer,
  getOrCreateCourseSubscriptionPrice,
  normalizeCoursePrice,
} from "@/lib/payments/server/stripe-helpers";
import type { ProductOffer } from "@/domain/product-pricing";
import type { CourseRow } from "@/lib/payments/server/stripe-helpers";

const { supabaseQuery, userUpdates, db } = vi.hoisted(() => {
  // One self-returning object covers every chain the create helpers use:
  // .from().select().eq().maybeSingle() for the profile read, and
  // .from().update().eq()[.is().select()] awaited for the write. Awaiting the
  // chain resolves like the driver: { data: rows the UPDATE touched, error }.
  const db = {
    updatedRows: [{}] as unknown[],
    userRow: null as Record<string, unknown> | null,
  };
  const q: Record<string, unknown> = {};
  const updates: Array<Record<string, unknown>> = [];
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    is: () => q,
    update: (payload: Record<string, unknown>) => {
      updates.push(payload);
      return q;
    },
    maybeSingle: async () => ({ data: db.userRow, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ data: db.updatedRows, error: null }),
  });
  return { supabaseQuery: q, userUpdates: updates, db };
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

    await createFreshConnectedAccount({ uid: "uid_1", email: undefined, stripe, country: "US" });
    await createFreshConnectedAccount({
      uid: "uid_1",
      email: undefined,
      stripe,
      replacingAccountId: "acct_orphan",
      country: "US",
    });

    expect(create.mock.calls[0][1].idempotencyKey).toBe(
      "connect_account_uid_1_initial",
    );
    expect(create.mock.calls[1][1].idempotencyKey).toBe(
      "connect_account_uid_1_acct_orphan",
    );
  });

  function resetDb() {
    db.updatedRows = [{}];
    db.userRow = null;
    userUpdates.length = 0;
  }

  // Without a country Stripe silently locks the account to the platform's (US),
  // and the account can never move. The first-create key stays country-free on
  // purpose: see the two-tab test below.
  it("creates the account in the chosen country and records it", async () => {
    resetDb();
    const create = vi.fn().mockResolvedValue({ id: "acct_gb", country: "GB" });
    const stripe = { accounts: { create } } as unknown as Stripe;

    await createFreshConnectedAccount({ uid: "uid_1", email: undefined, stripe, country: "GB" });

    expect(create.mock.calls[0][0].country).toBe("GB");
    expect(create.mock.calls[0][0].business_type).toBe("individual");
    expect(create.mock.calls[0][1].idempotencyKey).toBe("connect_account_uid_1_initial");
    expect(userUpdates[0]).toMatchObject({
      stripe_connected_account_id: "acct_gb",
      stripe_connect_country: "GB",
    });
  });

  // Two tabs, FR then DE. With the country in the key both would mint an
  // Express account and the last write would orphan the other (maybe with KYC
  // on it). With one key, Stripe rejects the second as a different-params
  // replay; that must read as "try again", not a 500.
  it("turns a different-country replay of the first create into a 409", async () => {
    resetDb();
    // Same shape stripe-node gives StripeIdempotencyError (type = class name).
    const replay = Object.assign(
      new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."),
      { type: "StripeIdempotencyError", rawType: "idempotency_error" },
    );
    const create = vi.fn().mockRejectedValue(replay);
    const stripe = { accounts: { create } } as unknown as Stripe;

    await expect(
      createFreshConnectedAccount({ uid: "uid_1", email: undefined, stripe, country: "DE" }),
    ).rejects.toMatchObject({ status: 409, code: "connect_account_conflict" });
    expect(userUpdates).toHaveLength(0);
  });

  // A racing first create stored its account before ours: never overwrite it.
  // Keep the stored one and leave the orphan's id in the server log for ops.
  it("keeps the stored account when a racing first create already won", async () => {
    resetDb();
    db.updatedRows = [];
    db.userRow = { stripe_connected_account_id: "acct_winner" };
    const create = vi.fn().mockResolvedValue({ id: "acct_loser", country: "FR" });
    const stripe = { accounts: { create } } as unknown as Stripe;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const id = await createFreshConnectedAccount({ uid: "uid_1", email: undefined, stripe, country: "FR" });

    expect(id).toBe("acct_winner");
    expect(consoleError.mock.calls.flat().join(" ")).toContain("acct_loser");
    consoleError.mockRestore();
  });

  // Control: a same-key replay hands back the account that is already stored.
  it("returns the stored account quietly on a same-key replay", async () => {
    resetDb();
    db.updatedRows = [];
    db.userRow = { stripe_connected_account_id: "acct_same" };
    const create = vi.fn().mockResolvedValue({ id: "acct_same", country: "FR" });
    const stripe = { accounts: { create } } as unknown as Stripe;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const id = await createFreshConnectedAccount({ uid: "uid_1", email: undefined, stripe, country: "FR" });

    expect(id).toBe("acct_same");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // Control: a heal replaces a known dead id, so it still writes it directly.
  it("still records the new account on a self-heal recreate", async () => {
    resetDb();
    db.updatedRows = [];
    const create = vi.fn().mockResolvedValue({ id: "acct_healed", country: "FR" });
    const stripe = { accounts: { create } } as unknown as Stripe;

    const id = await createFreshConnectedAccount({
      uid: "uid_1",
      email: undefined,
      stripe,
      replacingAccountId: "acct_dead",
      country: "FR",
    });

    expect(id).toBe("acct_healed");
    expect(userUpdates[0]).toMatchObject({ stripe_connected_account_id: "acct_healed" });
  });
});

describe("connected-account course price cache", () => {
  function courseWithCache(cache: Record<string, unknown> | null = {}) {
    return {
      id: "course_1", owner_id: "teacher_1", title: "Course",
      stripe_subscription_price: cache === null ? null : {
        priceId: "price_cached", amountMinor: 12_000, currency: "usd",
        interval: "month", accountId: "acct_teacher", ...cache,
      },
    } as CourseRow;
  }

  function price(overrides: Record<string, unknown> = {}) {
    return {
      id: "price_cached", active: true, type: "recurring", billing_scheme: "per_unit",
      unit_amount: 12_000, unit_amount_decimal: "12000", currency: "usd",
      transform_quantity: null, custom_unit_amount: null,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
      metadata: { courseId: "course_1", ownerId: "teacher_1", kind: "course_subscription" },
      product: { id: "prod_course", active: true, metadata: { courseId: "course_1", ownerId: "teacher_1" } },
      ...overrides,
    };
  }

  function client(cached = price()) {
    const retrieve = vi.fn().mockResolvedValue(cached);
    const create = vi.fn().mockResolvedValue({ id: "price_fresh" });
    return { stripe: { prices: { retrieve, create } } as unknown as Stripe, retrieve, create };
  }

  it("reuses a cache only after Stripe verifies its current terms and product on the owner's account", async () => {
    const { stripe, retrieve, create } = client();

    const id = await getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(), "course_1", 12_000, "usd", "month", "acct_teacher");

    expect(id).toBe("price_cached");
    expect(retrieve).toHaveBeenCalledWith("price_cached", { expand: ["product"] }, { stripeAccount: "acct_teacher" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["lower amount", { unit_amount: 100, unit_amount_decimal: "100" }],
    ["other currency", { currency: "brl" }],
    ["archived price", { active: false }],
    ["other interval", { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } }],
    ["multiple months", { recurring: { interval: "month", interval_count: 12, usage_type: "licensed" } }],
    ["metered amount", { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } }],
    ["transformed quantity", { transform_quantity: { divide_by: 100, round: "down" } }],
    ["other course metadata", { metadata: { courseId: "course_other", ownerId: "teacher_1", kind: "course_subscription" } }],
    ["other product owner", { product: { id: "prod_other", active: true, metadata: { courseId: "course_1", ownerId: "teacher_other" } } }],
    ["deleted product", { product: { id: "prod_deleted", deleted: true } }],
  ])("replaces %s instead of trusting matching course-cache fields", async (_case, changed) => {
    const { stripe, create } = client(price(changed as Record<string, unknown>));

    const id = await getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(), "course_1", 12_000, "usd", "month", "acct_teacher");

    expect(id).toBe("price_fresh");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      unit_amount: 12_000, currency: "usd", recurring: { interval: "month" },
      metadata: { courseId: "course_1", ownerId: "teacher_1", kind: "course_subscription" },
    }), expect.objectContaining({ stripeAccount: "acct_teacher", idempotencyKey: expect.any(String) }));
  });

  it("replaces a price that does not exist on the owner's account", async () => {
    const { stripe, retrieve } = client();
    retrieve.mockRejectedValueOnce(Object.assign(new Error("No such price"), { code: "resource_missing" }));

    expect(await getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(), "course_1", 12_000, "usd", "month", "acct_teacher")).toBe("price_fresh");
  });

  it("fails closed on a transient Stripe read without minting another price", async () => {
    const { stripe, retrieve, create } = client();
    retrieve.mockRejectedValueOnce(new Error("Stripe unavailable"));

    await expect(getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(), "course_1", 12_000, "usd", "month", "acct_teacher")).rejects.toThrow("Stripe unavailable");
    expect(create).not.toHaveBeenCalled();
  });

  it("validates zero-decimal currency amounts in Stripe units", async () => {
    const { stripe, create, retrieve } = client(price({ unit_amount: 120, unit_amount_decimal: "120", currency: "jpy" }));

    expect(await getOrCreateCourseSubscriptionPrice(stripe, courseWithCache({ currency: "jpy" }), "course_1", 12_000, "jpy", "month", "acct_teacher")).toBe("price_cached");
    expect(retrieve).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("deduplicates first-use creation and gives replacement of an archived price a fresh key", async () => {
    const { stripe, create } = client(price({ active: false }));
    await Promise.all([
      getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(null), "course_1", 12_000, "usd", "month", "acct_teacher"),
      getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(null), "course_1", 12_000, "usd", "month", "acct_teacher"),
    ]);
    await getOrCreateCourseSubscriptionPrice(stripe, courseWithCache(), "course_1", 12_000, "usd", "month", "acct_teacher");

    const keys = create.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[0].length).toBeLessThanOrEqual(255);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
