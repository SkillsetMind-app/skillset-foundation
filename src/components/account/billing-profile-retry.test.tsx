import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";
import { I18nProvider } from "@/components/i18n/i18n-provider";

// Billing › Overview when the PROFILE does not load: the sentence told the user to refresh the
// page and had no button. Now the notice gets "Try again", which subscribes to the
// profile read again, only once.
type Read = { next: (profile: { stripeCustomerId?: string } | null) => void; fail: (error: Error) => void };

const mocks = vi.hoisted(() => ({
  // Stable object: a new one on every render would resubscribe the read.
  user: { uid: "learner-1", roles: ["student"] },
  reads: [] as Read[],
  portal: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ tab: "overview" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/orders", () => ({
  subscribeToUserOrders: (_uid: string, next: (orders: never[]) => void) => {
    next([]);
    return () => {};
  },
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, next: Read["next"], fail: Read["fail"]) => {
    mocks.reads.push({ next, fail });
    return () => {};
  },
}));
vi.mock("@/lib/payments/billing", () => ({
  fetchPlanBillingState: () => Promise.resolve({ trialEligible: false, subscription: null }),
  openBillingPortal: mocks.portal,
  requestOrderRefund: vi.fn(),
}));
vi.mock("@/components/account/plans-panel", () => ({ PlansPanel: () => null }));

beforeEach(() => {
  mocks.reads = [];
  mocks.portal.mockReset();
});
afterEach(cleanup);

function renderBilling() {
  render(<I18nProvider initialLocale="en"><BillingTabs /></I18nProvider>);
}

describe("Billing › Overview with the profile read failing", () => {
  it("shows 'Try again', subscribes to the profile again once, and the portal appears", () => {
    renderBilling();
    expect(mocks.reads).toHaveLength(1);
    act(() => mocks.reads[0].fail(new Error("offline")));

    expect(screen.getByText("We couldn't load your billing details right now.")).toBeInTheDocument();
    expect(screen.queryByText(/Refresh to try again/)).toBeNull();
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    // Reading: the usual skeleton, and only one new subscription.
    expect(screen.getByRole("status")).toHaveTextContent("Loading your billing overview...");
    expect(mocks.reads).toHaveLength(2);

    act(() => mocks.reads[1].next({ stripeCustomerId: "cus_1" }));
    expect(screen.getByRole("button", { name: "Open Stripe portal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.reads).toHaveLength(2);
  });

  it("the error from opening the portal does not get 'Try again'", async () => {
    mocks.portal.mockRejectedValue(new Error("boom"));
    renderBilling();
    act(() => mocks.reads[0].next({ stripeCustomerId: "cus_1" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Stripe portal" }));
    expect(
      await screen.findByText("Could not open the Stripe billing portal. Please try again or contact support."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
