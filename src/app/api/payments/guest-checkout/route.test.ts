import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireUserId: vi.fn(),
  getCourseRow: vi.fn(),
  getUserRow: vi.fn(),
  loadOffers: vi.fn(),
  normalizePrice: vi.fn(),
  getStripe: vi.fn(),
  createSession: vi.fn(),
  expireSession: vi.fn(),
  subscriptionInterval: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/i18n/server", () => ({ getServerLocale: async () => "en" }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
}));
vi.mock("@/lib/payments/server/app-url", () => ({ getAppUrl: () => "https://skillset.test" }));
vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
  getStripeAccountCountry: vi.fn(async () => null),
}));
vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  courseSubscriptionInterval: mocks.subscriptionInterval,
  getCourseRow: mocks.getCourseRow,
  getUserRow: mocks.getUserRow,
  getOrCreateAccountPercentOffCoupon: vi.fn(),
  getOrCreateCourseSubscriptionPrice: vi.fn(),
  loadCourseProductOffers: mocks.loadOffers,
  normalizeCoursePrice: mocks.normalizePrice,
}));

import { POST as signedInPOST } from "@/app/api/payments/checkout/route";
import { POST as accessLinkPOST } from "@/app/api/payments/guest-checkout/access-link/route";
import { POST } from "@/app/api/payments/guest-checkout/route";
import {
  decodeGuestCheckoutCookie,
  encodeGuestCheckoutCookie,
  GUEST_CHECKOUT_COOKIE,
} from "@/lib/payments/server/guest-checkout";

type AdminInput = {
  existingUserId?: string | null;
  enrollment?: { status: string } | null;
  createUserFails?: boolean;
  racedUserId?: string;
  lockReply?: { action: string; checkout_url: string | null };
  rateLimited?: string;
  rateLimitDown?: boolean;
  termsFail?: boolean;
  subscription?: { id: string; status: string } | null;
};

function createAdmin(input: AdminInput = {}) {
  const usersUpdates: Array<Record<string, unknown>> = [];
  const usersDeletes: string[] = [];
  const orderInserts: Array<Record<string, unknown>> = [];
  let lookups = 0;

  class Query {
    private mode: "read" | "update" | "delete" = "read";
    constructor(private readonly table: string) {}
    select() { return this; }
    eq() { return this; }
    in() { return this; }
    limit() { return this; }
    update(values: Record<string, unknown>) {
      this.mode = "update";
      if (this.table === "users") usersUpdates.push(values);
      return this;
    }
    delete() {
      this.mode = "delete";
      if (this.table === "users") usersDeletes.push(this.table);
      return this;
    }
    async insert(values: Record<string, unknown>) {
      if (this.table === "orders") orderInserts.push(values);
      return { error: null };
    }
    maybeSingle() { return Promise.resolve(this.result(true)); }
    then<A = unknown, B = never>(
      onfulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ) {
      return Promise.resolve(this.result(false)).then(onfulfilled, onrejected);
    }
    private result(single: boolean) {
      if (this.mode === "delete") return { data: null, error: null };
      if (this.mode === "update") {
        if (this.table === "users") {
          return input.termsFail ? { data: null, error: { message: "write failed" } } : { data: [{ uid: "new-user" }], error: null };
        }
        if (this.table === "orders") return { data: { id: "order" }, error: null };
        if (this.table === "checkout_locks") return { data: { lock_key: "lock" }, error: null };
        return { data: null, error: null };
      }
      if (this.table === "enrollments") return { data: input.enrollment ?? null, error: null };
      if (this.table === "course_subscriptions") return { data: input.subscription ?? null, error: null };
      return { data: single ? null : [], error: null };
    }
  }

  return {
    usersUpdates,
    usersDeletes,
    orderInserts,
    from: vi.fn((table: string) => new Query(table)),
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "enforce_rate_limit") {
        if (input.rateLimitDown) return { data: null, error: { message: "connection refused" } };
        return input.rateLimited && String(params.p_key).startsWith(input.rateLimited)
          ? { data: null, error: { message: "RATE_LIMIT" } }
          : { data: true, error: null };
      }
      if (name === "find_auth_user_id_by_email") {
        lookups += 1;
        // A lost createUser race finds the account on the second lookup.
        if (input.createUserFails && lookups > 1) return { data: input.racedUserId ?? null, error: null };
        return { data: input.existingUserId ?? null, error: null };
      }
      if (name === "course_owner_can_sell") return { data: true, error: null };
      if (name === "claim_checkout_lock") {
        return { data: [input.lockReply ?? { action: "claim", checkout_url: null }], error: null };
      }
      throw new Error(`Unexpected rpc: ${name}`);
    }),
    auth: {
      admin: {
        createUser: vi.fn(async () => input.createUserFails
          ? { data: { user: null }, error: { code: "email_exists", status: 422 } }
          : { data: { user: { id: "new-user" } }, error: null }),
        deleteUser: vi.fn(async () => ({ data: {}, error: null })),
      },
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
}

const validBody = {
  courseId: "course",
  name: "Ana Prado",
  email: "  Ana@Example.com ",
  acceptTerms: true,
  captchaToken: "turnstile-token",
};

function guestRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/payments/guest-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function turnstileAnswers(success: boolean, hostname: string | undefined = "skillset.test") {
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ success, hostname })));
}

describe("guest checkout", () => {
  let admin: ReturnType<typeof createAdmin>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret");
    vi.stubEnv("GUEST_CHECKOUT_COOKIE_SECRET", "cookie-secret");
    vi.stubGlobal("fetch", mocks.fetch);
    turnstileAnswers(true);
    mocks.subscriptionInterval.mockReturnValue(null);
    admin = createAdmin();
    mocks.getAdmin.mockImplementation(() => admin);
    mocks.getCourseRow.mockResolvedValue({
      id: "course",
      owner_id: "teacher",
      title: "Clinical Foundations",
      summary: "A course",
      status: "published",
      payment_type: "one_time",
      price_amount_minor: 12_000,
      currency: "USD",
      installments_enabled: false,
      installments_max: null,
      cover_image_url: null,
    });
    mocks.getUserRow.mockImplementation(async (id: string) => id === "teacher"
      ? {
          uid: "teacher",
          current_plan_id: "professional",
          stripe_connected_account_id: "acct_teacher",
          stripe_connect_charges_enabled: true,
          stripe_connect_payouts_enabled: true,
        }
      : { uid: id, email: "ana@example.com" });
    mocks.loadOffers.mockResolvedValue([]);
    mocks.normalizePrice.mockImplementation(
      (_course: unknown, _offers: unknown, selection: { offerId?: string; priceId?: string }) => ({
        amountMinor: 12_000,
        currency: "usd",
        paymentType: "one_time",
        source: selection.offerId ? "offer" : "legacy",
        offerId: selection.offerId,
        priceId: selection.priceId,
      }),
    );
    mocks.createSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.example/cs_1" });
    mocks.getStripe.mockReturnValue({
      checkout: { sessions: { create: mocks.createSession, expire: mocks.expireSession } },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["the flag is off", "NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "false"],
    ["the Turnstile secret is missing", "TURNSTILE_SECRET_KEY", ""],
    ["the Turnstile site key is missing", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", ""],
    ["the cookie secret is missing", "GUEST_CHECKOUT_COOKIE_SECRET", ""],
  ])("is off (404) when %s", async (_label, name, value) => {
    vi.stubEnv(name, value);

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("guest_checkout_disabled");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it.each([
    ["terms not accepted", { ...validBody, acceptTerms: false }],
    ["terms as a string", { ...validBody, acceptTerms: "true" }],
    ["empty name", { ...validBody, name: "   " }],
    ["name over 80", { ...validBody, name: "a".repeat(81) }],
    ["bad email", { ...validBody, email: "ana@example" }],
    ["email over 254", { ...validBody, email: `${"a".repeat(250)}@example.com` }],
    ["no captcha", { ...validBody, captchaToken: "" }],
    ["no course", { ...validBody, courseId: "" }],
    ["not an object", "[1]"],
    ["not JSON", "{"],
  ])("rejects %s before any check or account", async (_label, body) => {
    const response = await POST(guestRequest(body));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("verifies the Turnstile token server-side and stops when it fails", async () => {
    turnstileAnswers(false);

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("captcha_failed");
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = init.body as URLSearchParams;
    expect(form.get("secret")).toBe("turnstile-secret");
    expect(form.get("response")).toBe("turnstile-token");
    expect(form.get("remoteip")).toBe("203.0.113.7");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["another site", "evil.example"],
    ["no hostname", undefined],
  ])("refuses a Turnstile token solved on %s", async (_label, hostname) => {
    turnstileAnswers(true, hostname);

    const response = await POST(guestRequest(validBody));

    expect((await response.json()).code).toBe("captcha_failed");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("takes a token solved on the www host of this app", async () => {
    turnstileAnswers(true, "www.skillset.test");

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(200);
  });

  it("treats an unreachable Turnstile as a failed check", async () => {
    mocks.fetch.mockRejectedValue(new Error("network down"));

    const response = await POST(guestRequest(validBody));

    expect((await response.json()).code).toBe("captcha_failed");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("limits per IP before calling Turnstile", async () => {
    admin = createAdmin({ rateLimited: "guest_checkout_ip_" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(429);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("limits per e-mail, keyed by a hash and never the address", async () => {
    admin = createAdmin({ rateLimited: "guest_checkout_email_" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(429);
    const keys = admin.rpc.mock.calls
      .filter(([name]) => name === "enforce_rate_limit")
      .map(([, params]) => String(params.p_key));
    expect(keys.some((key) => key.includes("ana"))).toBe(false);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("stops at the platform-wide hourly ceiling, before any account", async () => {
    admin = createAdmin({ rateLimited: "guest_checkout_global" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(429);
    expect(admin.rpc).toHaveBeenCalledWith("enforce_rate_limit", {
      p_key: "guest_checkout_global",
      p_limit: 60,
      p_window_ms: 3_600_000,
    });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter itself is down", async () => {
    admin = createAdmin({ rateLimitDown: true });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(500);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("answers an address that cannot take an account like a course that cannot be bought", async () => {
    admin = createAdmin({ createUserFails: true });
    const refused = await POST(guestRequest(validBody));

    mocks.getCourseRow.mockResolvedValue({ id: "course", owner_id: "teacher", status: "draft" });
    const unsellable = await POST(guestRequest(validBody));

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual(await unsellable.json());
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("makes no account for a course that does not exist", async () => {
    mocks.getCourseRow.mockResolvedValue(null);

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(404);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("creates a new account silently, records the terms, and opens the session for it", async () => {
    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.example/cs_1" });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "ana@example.com",
      email_confirm: false,
      user_metadata: { name: "Ana Prado", locale: "en", created_via: "guest_checkout" },
      app_metadata: { created_via: "guest_checkout" },
    });
    expect(admin.usersUpdates).toEqual([
      expect.objectContaining({
        terms_version: "2026-09-24",
        privacy_version: "2026-09-24",
        terms_accepted_at: expect.any(String),
        privacy_accepted_at: expect.any(String),
      }),
    ]);
    const [params] = mocks.createSession.mock.calls[0];
    expect(params.client_reference_id).toBe("new-user");
    expect(params.metadata.userId).toBe("new-user");
    expect(params.customer_email).toBe("ana@example.com");
    expect(params.success_url).toBe("https://skillset.test/checkout/thanks?course=course");
    expect(admin.orderInserts[0]).toMatchObject({ user_id: "new-user", course_id: "course", status: "pending" });
    // Nothing is sent, and nobody is signed in, before payment.
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();

    const cookie = response.cookies.get(GUEST_CHECKOUT_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(decodeGuestCheckoutCookie(cookie?.value)).toEqual({ email: "ana@example.com", courseId: "course" });
  });

  it("uses an existing account as is: no new account, no terms written, no sign-in", async () => {
    admin = createAdmin({ existingUserId: "existing-user" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("find_auth_user_id_by_email", { p_email: "ana@example.com" });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.usersUpdates).toEqual([]);
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(mocks.createSession.mock.calls[0][0].client_reference_id).toBe("existing-user");
  });

  it("takes the account that won a creation race, without writing its terms", async () => {
    admin = createAdmin({ createUserFails: true, racedUserId: "raced-user" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(200);
    expect(admin.usersUpdates).toEqual([]);
    expect(mocks.createSession.mock.calls[0][0].client_reference_id).toBe("raced-user");
  });

  it("removes the new account when the purchase cannot go ahead, answering exactly the same", async () => {
    // The creator's Stripe account is not ready: the shared builder refuses.
    mocks.getUserRow.mockImplementation(async (id: string) => id === "teacher"
      ? { uid: "teacher", current_plan_id: "professional", stripe_connected_account_id: "acct_teacher", stripe_connect_charges_enabled: false, stripe_connect_payouts_enabled: false }
      : { uid: id, email: "ana@example.com" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "This teacher must finish Stripe onboarding before paid checkout opens.",
    });
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("new-user");
    expect(admin.usersDeletes).toEqual(["users"]);
    expect(response.cookies.get(GUEST_CHECKOUT_COOKIE)).toBeUndefined();
  });

  it("keeps an existing account when its purchase cannot go ahead", async () => {
    admin = createAdmin({ existingUserId: "existing-user" });
    mocks.getUserRow.mockImplementation(async (id: string) => id === "teacher"
      ? { uid: "teacher", current_plan_id: "professional", stripe_connected_account_id: null }
      : { uid: id, email: "ana@example.com" });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(400);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("removes the new account when its terms cannot be recorded", async () => {
    admin = createAdmin({ termsFail: true });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(500);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("new-user");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(["active", "completed"])("sends the access link and opens no session when the account is already %s", async (status) => {
    admin = createAdmin({ existingUserId: "existing-user", enrollment: { status } });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "access_link_sent" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(admin.orderInserts).toEqual([]);
    expect(admin.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://skillset.test/auth/confirm?next=%2Flearn%2Fcourses%2Fcourse",
      },
    });
  });

  it("sends the access link when the account already has a subscription to the course (409)", async () => {
    mocks.subscriptionInterval.mockReturnValue("month");
    admin = createAdmin({ existingUserId: "existing-user", subscription: { id: "sub", status: "active" } });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "access_link_sent" });
    expect(admin.auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["a checkout already starting", { action: "wait", checkout_url: null }],
    ["a checkout open for another offer", { action: "reuse", checkout_url: "https://checkout.example/open" }],
  ])("answers one neutral 'payment in progress', with no e-mail, for %s", async (_label, lockReply) => {
    admin = createAdmin({ existingUserId: "existing-user", lockReply });

    const response = await POST(guestRequest(validBody));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "You have a payment in progress for this course. Finish it or try again in a few minutes.",
      code: "checkout_pending",
    });
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("answers the same way for the course owner's own e-mail", async () => {
    admin = createAdmin({ existingUserId: "teacher" });

    const response = await POST(guestRequest(validBody));

    expect(await response.json()).toEqual({ status: "access_link_sent" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("opens the same Stripe session as the signed-in route for the same course and offer", async () => {
    const offer = { offerId: "offer-1", priceId: "price-1" };
    admin = createAdmin({ existingUserId: "buyer" });
    await POST(guestRequest({ ...validBody, ...offer, email: "ana@example.com" }));
    mocks.requireUserId.mockResolvedValue("buyer");
    await signedInPOST(new Request("http://localhost/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: "course", ...offer }),
    }));

    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    // Per-attempt values (order id, expiry) and the return page differ by design.
    type SessionParams = {
      success_url?: string;
      expires_at?: number;
      metadata: Record<string, string>;
      payment_intent_data: { metadata: Record<string, string> };
    };
    const normalize = ([params, options]: [SessionParams, { stripeAccount?: string }]) => {
      const copy = structuredClone(params);
      delete copy.success_url;
      delete copy.expires_at;
      delete copy.metadata.orderId;
      delete copy.payment_intent_data.metadata.orderId;
      return { params: copy, stripeAccount: options.stripeAccount };
    };
    const [guest, signedIn] = mocks.createSession.mock.calls.map((call) =>
      normalize(call as [SessionParams, { stripeAccount?: string }]));
    expect(guest).toEqual(signedIn);
    expect(guest.params.metadata).toMatchObject({ userId: "buyer", offerId: "offer-1", priceId: "price-1", teacherId: "teacher" });
    expect(guest.stripeAccount).toBe("acct_teacher");
    expect(mocks.createSession.mock.calls[1][0].success_url)
      .toBe("https://skillset.test/learn/courses/course?checkout=success");
  });
});

describe("guest checkout access link (thank-you page)", () => {
  let admin: ReturnType<typeof createAdmin>;

  function linkRequest(cookie?: string) {
    return new NextRequest("http://localhost/api/payments/guest-checkout/access-link", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.7", ...(cookie ? { cookie: `${GUEST_CHECKOUT_COOKIE}=${cookie}` } : {}) },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret");
    vi.stubEnv("GUEST_CHECKOUT_COOKIE_SECRET", "cookie-secret");
    admin = createAdmin();
    mocks.getAdmin.mockImplementation(() => admin);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("sends the link to the address in the signed cookie", async () => {
    const response = await accessLinkPOST(linkRequest(encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course" })));

    expect(response.status).toBe(200);
    expect(admin.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://skillset.test/auth/confirm?next=%2Flearn%2Fcourses%2Fcourse",
      },
    });
  });

  // Built inside the test, once the secret is in the environment.
  it.each([
    ["no cookie", (): string | undefined => undefined],
    ["a cookie whose address was swapped", () => {
      const signature = encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course" }).split(".")[1];
      const swapped = Buffer.from(JSON.stringify({ e: "other@example.com", c: "course", x: Date.now() + 60_000 })).toString("base64url");
      return `${swapped}.${signature}`;
    }],
    ["an expired cookie", () => encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course" }, Date.now() - 3 * 60 * 60 * 1000)],
  ])("sends nothing with %s", async (_label, cookie) => {
    const response = await accessLinkPOST(linkRequest(cookie()));

    expect(response.status).toBe(404);
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("stops at the platform-wide hourly ceiling", async () => {
    admin = createAdmin({ rateLimited: "guest_access_link_global" });

    const response = await accessLinkPOST(linkRequest(encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course" })));

    expect(response.status).toBe(429);
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("is rate limited per e-mail", async () => {
    admin = createAdmin({ rateLimited: "guest_access_link_email_" });

    const response = await accessLinkPOST(linkRequest(encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course" })));

    expect(response.status).toBe(429);
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("is off with the flag off", async () => {
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "");

    const response = await accessLinkPOST(linkRequest(encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course" })));

    expect(response.status).toBe(404);
    expect(admin.auth.signInWithOtp).not.toHaveBeenCalled();
  });
});
