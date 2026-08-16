import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  getUserRow: vi.fn(),
  getStripe: vi.fn(),
  createPortalSession: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("@/lib/payments/server/app-url", () => ({
  getAppUrl: () => "https://skillset.test",
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
}));

vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  getUserRow: mocks.getUserRow,
}));

import { POST } from "@/app/api/payments/billing/portal/route";
import { PaymentError } from "@/lib/payments/server/auth";

describe("POST /api/payments/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.createPortalSession.mockResolvedValue({
      url: "https://billing.stripe.test/session/live",
    });
    mocks.getStripe.mockReturnValue({
      billingPortal: { sessions: { create: mocks.createPortalSession } },
    });
  });

  // The portal is a window onto an EXISTING customer. Minting one here would
  // open an empty portal and read to the subscriber as "my subscription is
  // gone", so the route must refuse instead.
  it("refuses when the account has no Stripe customer", async () => {
    mocks.getUserRow.mockResolvedValue({ stripe_customer_id: null });

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });

  // Same refusal with no profile row at all: the optional chain must not read
  // as "no customer id required".
  it("refuses when the profile row is missing", async () => {
    mocks.getUserRow.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });

  // The throttle has to run BEFORE Stripe, or a hammered endpoint mints portal
  // sessions on every request.
  it("throttles before reaching Stripe", async () => {
    mocks.getUserRow.mockResolvedValue({ stripe_customer_id: "cus_1" });
    mocks.enforceRateLimit.mockRejectedValue(
      new PaymentError("Too many requests.", 429),
    );

    const response = await POST();

    expect(response.status).toBe(429);
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });

  // Control: a real subscriber opens the portal on THEIR customer and returns
  // to the subscriptions tab, not the site root.
  it("opens the portal on the stored customer and returns to billing", async () => {
    mocks.getUserRow.mockResolvedValue({ stripe_customer_id: "cus_1" });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://billing.stripe.test/session/live");
    expect(mocks.createPortalSession.mock.calls[0][0].customer).toBe("cus_1");
    expect(mocks.createPortalSession.mock.calls[0][0].return_url).toBe(
      "https://skillset.test/account/billing?tab=subscriptions",
    );
  });
});
