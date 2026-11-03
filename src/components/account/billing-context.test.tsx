import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { UserProfile } from "@/domain/user-profile";
import type { PlanBillingState, PlanSubscriptionView } from "@/lib/payments/billing";

const mocks = vi.hoisted(() => ({
  user: { uid: "creator-fixture", roles: ["teacher"] },
  profile: { currentPlanId: "pro", stripeCustomerId: "customer-fixture" } as Pick<UserProfile, "currentPlanId" | "stripeCustomerId">,
  tab: "overview",
  billing: vi.fn(),
  portal: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams({ tab: mocks.tab }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/orders", () => ({
  subscribeToUserOrders: (_uid: string, next: (orders: []) => void) => { next([]); return vi.fn(); },
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, next: (profile: typeof mocks.profile) => void) => { next(mocks.profile); return vi.fn(); },
}));
vi.mock("@/lib/payments/billing", () => ({
  fetchPlanBillingState: mocks.billing,
  openBillingPortal: mocks.portal,
  requestOrderRefund: vi.fn(),
}));
vi.mock("@/components/account/plans-panel", () => ({ PlansPanel: () => <div>Plans fixture</div> }));

const subscription: PlanSubscriptionView = {
  planId: "basic", cycle: "monthly", status: "active", trialEnd: null,
  currentPeriodEnd: "2026-12-03T12:00:00Z", cancelAtPeriodEnd: false,
  contractedPrice: { amountMinor: 700, currency: "usd", cycle: "monthly" },
};

function mount(locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}><BillingTabs /></I18nProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { uid: "creator-fixture", roles: ["teacher"] };
  mocks.profile = { currentPlanId: "pro", stripeCustomerId: "customer-fixture" };
  mocks.tab = "overview";
  mocks.billing.mockResolvedValue({ trialEligible: false, subscription });
  mocks.portal.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("billing subscription context", () => {
  it.each([
    ["en", "monthly", "Monthly", "Active", "Manage subscription"],
    ["es", "monthly", "Mensual", "Activo", "Gestionar suscripción"],
    ["en", "yearly", "Yearly", "Active", "Manage subscription"],
    ["es", "yearly", "Anual", "Activo", "Gestionar suscripción"],
  ] as const)("uses the subscription plan, status and %s/%s interval, not the profile or current offer", async (locale, cycle, interval, status, manage) => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: { ...subscription, cycle } });
    mount(locale);
    expect(await screen.findByText("Basic")).toBeInTheDocument();
    expect(screen.getByText(interval)).toBeInTheDocument();
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.queryByText("Pro")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: manage }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
    expect(mocks.billing).toHaveBeenCalledTimes(1);
  });

  it.each(["en", "es"] as const)("offers starting a subscription separately from existing history in %s", async (locale) => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: null });
    mount(locale);
    expect(await screen.findByText(locale === "en" ? "No subscription" : "Sin suscripción")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Start subscription" : "Iniciar suscripción" }));
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing?tab=subscriptions", { scroll: false });
    expect(mocks.portal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^(Manage subscription|Gestionar suscripción)$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Invoices and payment methods" : "Facturas y métodos de pago" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
  });

  it("offers plans without attempting to create a customer or open a portal", async () => {
    mocks.profile = { currentPlanId: "free", stripeCustomerId: null };
    mocks.billing.mockResolvedValue({ trialEligible: true, subscription: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start subscription" }));
    expect(mocks.portal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Invoices and payment methods" })).toBeNull();
  });

  it.each([
    ["trialing", "Trialing"], ["past_due", "Past due"], ["unpaid", "Unpaid"],
  ])("keeps management available for %s instead of offering another subscription", async (status, label) => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: { ...subscription, status } });
    mount();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start subscription" })).toBeNull();
  });

  it.each(["en", "es"] as const)("shows scheduled cancellation without hiding management in %s", async (locale) => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: { ...subscription, cancelAtPeriodEnd: true } });
    mount(locale);
    expect(await screen.findByText(locale === "en" ? "Cancellation scheduled" : "Cancelación programada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: locale === "en" ? "Manage subscription" : "Gestionar suscripción" })).toBeInTheDocument();
  });

  it("does not claim no subscription while the read is pending, and preserves portal access", async () => {
    let resolve!: (value: PlanBillingState) => void;
    mocks.billing.mockReturnValue(new Promise<PlanBillingState>((done) => { resolve = done; }));
    mount();
    expect(screen.queryByText("No subscription")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start subscription" })).toBeNull();
    expect(screen.getByRole("button", { name: "Invoices and payment methods" })).toBeInTheDocument();
    await act(async () => resolve({ trialEligible: false, subscription }));
    expect(screen.getByText("Basic")).toBeInTheDocument();
  });

  it("keeps the read failure neutral and history accessible", async () => {
    mocks.billing.mockRejectedValue(new Error("private provider details"));
    mount();
    expect(await screen.findByText("We couldn't load your billing details right now. Refresh to try again.")).toBeInTheDocument();
    expect(screen.queryByText("private provider details")).toBeNull();
    expect(screen.queryByText("No subscription")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start subscription" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Invoices and payment methods" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
  });

  it("does not fill missing contract details from the profile or the current offer", async () => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: { ...subscription, planId: null, cycle: null, status: "unknown-fixture" } });
    mount();
    expect(await screen.findAllByText("Unavailable")).toHaveLength(3);
    expect(screen.queryByText("Pro")).toBeNull();
    expect(screen.queryByText("Monthly")).toBeNull();
    expect(screen.queryByText("unknown-fixture")).toBeNull();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
  });

  it("preserves payment methods without reading or requiring an active subscription", () => {
    mocks.tab = "payment-methods";
    mocks.profile.currentPlanId = "free";
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Manage payment methods" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
    expect(mocks.billing).not.toHaveBeenCalled();
  });

  it("does not request a creator subscription for a learner", () => {
    mocks.user.roles = ["student"];
    mount();
    expect(mocks.billing).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start subscription" })).toBeNull();
    expect(screen.queryByText("Creator plan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Stripe portal" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
  });
});
