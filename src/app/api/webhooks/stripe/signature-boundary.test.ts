// @vitest-environment node
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  configured: vi.fn(() => true),
  notifyOps: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/payments/server/stripe", () => ({
  getStripeClient: mocks.getStripe,
  isStripeConfigured: mocks.configured,
}));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));

import { POST } from "@/app/api/webhooks/stripe/route";

// Valores sinteticos; a verificacao criptografica do SDK e local, sem API.
const platformSecret = "unit-test-platform-signing-secret";
const connectSecret = "unit-test-connect-signing-secret";
const sdkTransport = vi.fn(async () => {
  throw new Error("No Stripe API transport is allowed in a signature boundary test.");
});
const stripe = new Stripe("unit-test-only-not-an-api-key", {
  httpClient: Stripe.createFetchHttpClient(sdkTransport),
  maxNetworkRetries: 0,
});
const now = new Date("2026-10-30T12:00:00.000Z");

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_signature_boundary",
    object: "event",
    type: "customer.created",
    livemode: false,
    data: { object: { id: "cus_synthetic" } },
    ...overrides,
  });
}

function sign(body: string, secret = platformSecret, ageSeconds = 0) {
  return stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    timestamp: Math.floor(now.getTime() / 1000) - ageSeconds,
  });
}

function request(body: string, signature?: string) {
  return new Request("https://skillset.test/api/webhooks/stripe", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  });
}

describe("Stripe webhook signature boundary with the real SDK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", platformSecret);
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", connectSecret);
    mocks.configured.mockReturnValue(true);
    mocks.getStripe.mockReturnValue(stripe);
    mocks.getAdmin.mockImplementation(() => {
      throw new Error("No database access is allowed in a boundary rejection test.");
    });
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("No network is allowed in a signature boundary test.");
    }));
  });

  afterEach(() => {
    const sdkRequests = sdkTransport.mock.calls.length;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    expect(sdkRequests).toBe(0);
  });

  it.each([
    ["platform", platformSecret],
    ["Connect", connectSecret],
  ])("accepts a real %s signature before ignoring an unrelated event", async (_endpoint, secret) => {
    const body = payload();
    const response = await POST(request(body, sign(body, secret)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it("accepts a Connect-only configuration without the platform signing secret", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const body = payload();
    const response = await POST(request(body, sign(body, connectSecret)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("rejects a missing signature before accessing data", async () => {
    const response = await POST(request(payload()));
    expect(response.status).toBe(400);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it.each(["wrong secret", "altered body", "expired timestamp", "malformed header", "invalid JSON"])(
    "rejects %s before accepting an event or writing data",
    async (scenario) => {
      const original = payload({ type: "checkout.session.completed" });
      const body = scenario === "altered body"
        ? original.replace("cus_synthetic", "cus_changed")
        : scenario === "invalid JSON" ? "{not-json" : original;
      const signature = scenario === "wrong secret"
        ? sign(original, "unit-test-untrusted-secret")
        : scenario === "expired timestamp" ? sign(original, platformSecret, 301)
          : scenario === "malformed header" ? "not-a-stripe-signature"
            : sign(scenario === "invalid JSON" ? body : original);
      const response = await POST(request(body, signature));
      expect(response.status).toBe(400);
      expect(mocks.getAdmin).not.toHaveBeenCalled();
      expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({
        event: "stripe.webhook.bad_signature",
      }));
    },
  );

  it("fails closed when both endpoint signing secrets are missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "");
    const body = payload();
    const response = await POST(request(body, sign(body)));
    expect(response.status).toBe(503);
    expect(mocks.getStripe).not.toHaveBeenCalled();
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("ignores a correctly signed test checkout on a live-key server without writing data", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_a_real_key");
    const body = payload({ type: "checkout.session.completed", account: "acct_synthetic" });
    const response = await POST(request(body, sign(body, connectSecret)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("keeps a correctly signed live checkout retryable on a test-key server", async () => {
    const body = payload({ type: "checkout.session.completed", livemode: true, account: "acct_synthetic" });
    const response = await POST(request(body, sign(body, connectSecret)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "payments_not_configured" }));
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("reaches idempotency only after verifying a matching signed Connect event", async () => {
    const query = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: "done" }, error: null }),
    };
    query.select.mockImplementation((columns: string) => columns === "stripe_event_id"
      ? Promise.resolve({ data: [], error: null }) : query);
    const from = vi.fn(() => query);
    mocks.getAdmin.mockReturnValue({ from });
    const body = payload({ type: "checkout.session.completed", account: "acct_synthetic" });
    const response = await POST(request(body, sign(body, connectSecret)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(from).toHaveBeenCalledWith("processed_stripe_events");
    expect(query.eq).toHaveBeenCalledWith("stripe_event_id", "evt_signature_boundary");
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });
});
