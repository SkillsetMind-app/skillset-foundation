import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { Order } from "@/domain/order";

// F-11: the summary and the purchases come from a single read (subscribeToUserOrders).
// When it fails, the notice gets "Try again", which subscribes again; never a
// "No purchases yet" or zeroed values in place of the error.
type Read = { next: (orders: Order[]) => void; fail: (error: Error) => void };

const mocks = vi.hoisted(() => ({
  // Stable object: a new one on every render would resubscribe the read.
  user: { uid: "learner-1", roles: ["student"] },
  tab: "overview",
  reads: [] as Read[],
  log: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ tab: mocks.tab }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/orders", () => ({
  subscribeToUserOrders: (_uid: string, next: Read["next"], fail: Read["fail"]) => {
    const index = mocks.reads.push({ next, fail });
    mocks.log.push(`assina ${index}`);
    return () => mocks.log.push(`desfaz ${index}`);
  },
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, next: (profile: { currentPlanId: string }) => void) => {
    next({ currentPlanId: "free" });
    return () => {};
  },
}));
vi.mock("@/lib/payments/billing", () => ({
  fetchPlanBillingState: () => Promise.resolve({ trialEligible: false, subscription: null }),
  openBillingPortal: vi.fn(),
  requestOrderRefund: vi.fn(),
}));
vi.mock("@/components/account/plans-panel", () => ({ PlansPanel: () => null }));

beforeEach(() => {
  mocks.reads = [];
  mocks.log = [];
});
afterEach(cleanup);

describe.each([
  ["overview", "Loading your billing overview...", "Lifetime spend"],
  ["purchases", "Loading your purchases...", "No purchases yet."],
])("Billing › %s with the purchases read failing", (tab, loading, loaded) => {
  it("shows the notice with 'Try again', subscribes again once, and the notice goes away when the read responds", async () => {
    mocks.tab = tab;
    render(<I18nProvider initialLocale="en"><BillingTabs /></I18nProvider>);
    expect(mocks.reads).toHaveLength(1);

    act(() => mocks.reads[0].fail(new Error("offline")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your purchases.");
    // No empty state or zero in place of the error.
    expect(screen.queryByText("No purchases yet.")).toBeNull();
    expect(screen.queryByText("Lifetime spend")).toBeNull();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    // The previous subscription is dropped before the new one, and only one new one.
    expect(mocks.log).toEqual(["assina 1", "desfaz 1", "assina 2"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(loading);
    expect(screen.queryByText(loaded)).toBeNull();

    act(() => mocks.reads[1].next([]));

    expect(screen.getByText(loaded)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.reads).toHaveLength(2);
  });
});
