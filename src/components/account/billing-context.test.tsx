import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { UserProfile } from "@/domain/user-profile";
import type { PlanBillingState, PlanSubscriptionView } from "@/lib/payments/billing";

const mocks = vi.hoisted(() => ({
  user: { uid: "creator-fixture", roles: ["teacher"] },
  profile: { currentPlanId: "pro", stripeCustomerId: "customer-fixture", updatedAt: "2026-11-03T20:00:00Z" } as Pick<UserProfile, "currentPlanId" | "stripeCustomerId" | "updatedAt">,
  profileStream: vi.fn(),
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
  subscribeToUserProfile: mocks.profileStream,
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
  mocks.profile = { currentPlanId: "pro", stripeCustomerId: "customer-fixture", updatedAt: "2026-11-03T20:00:00Z" };
  mocks.profileStream.mockImplementation((_uid: string, next: (profile: typeof mocks.profile) => void) => { next(mocks.profile); return vi.fn(); });
  mocks.tab = "overview";
  mocks.billing.mockResolvedValue({ trialEligible: false, subscription });
  mocks.portal.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("billing subscription context", () => {
  it.each([
    ["en", "monthly", "Monthly", "Active", "Manage subscription"],
    ["es", "monthly", "Mensual", "Activo", "Gestionar suscripción"],
    ["en", "yearly", "Yearly", "Active", "Manage subscription"],
    ["es", "yearly", "Anual", "Activo", "Gestionar suscripción"],
  ] as const)("separates profile access from the subscription plan, status and %s/%s interval", async (locale, cycle, interval, status, manage) => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: { ...subscription, cycle } });
    mount(locale);
    expect(await screen.findByText("Basic")).toBeInTheDocument();
    expect(screen.getByText(interval)).toBeInTheDocument();
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(within(screen.getByText(locale === "en" ? "Current access" : "Acceso actual").parentElement!).getByText("Pro")).toBeInTheDocument();
    expect(within(screen.getByText(locale === "en" ? "Stripe subscription" : "Suscripción de Stripe").parentElement!).getByText("Basic")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: manage }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
    expect(mocks.billing).toHaveBeenCalledTimes(1);
  });

  it.each(["en", "es"] as const)("offers a neutral plan review separately from existing history in %s", async (locale) => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: null });
    mount(locale);
    expect(await screen.findByText(locale === "en" ? "No current Stripe subscription" : "Sin suscripción actual en Stripe")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Review plans" : "Revisar planes" }));
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing?tab=subscriptions", { scroll: false });
    expect(mocks.portal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^(Manage subscription|Gestionar suscripción)$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Invoices and payment methods" : "Facturas y métodos de pago" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
  });

  it("offers plans without attempting to create a customer or open a portal", async () => {
    mocks.profile = { ...mocks.profile, currentPlanId: "free", stripeCustomerId: null };
    mocks.billing.mockResolvedValue({ trialEligible: true, subscription: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review plans" }));
    expect(within(screen.getByText("Current access").parentElement!).getByText("Default access")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Review plans" })).toBeNull();
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
    expect(screen.queryByText("No current Stripe subscription")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review plans" })).toBeNull();
    expect(screen.getByRole("button", { name: "Invoices and payment methods" })).toBeInTheDocument();
    await act(async () => resolve({ trialEligible: false, subscription }));
    expect(screen.getByText("Basic")).toBeInTheDocument();
  });

  it("keeps the read failure neutral and history accessible", async () => {
    mocks.billing.mockRejectedValue(new Error("private provider details"));
    mount();
    expect(await screen.findByText("We couldn't load your billing details right now. Refresh to try again.")).toBeInTheDocument();
    expect(screen.queryByText("private provider details")).toBeNull();
    expect(screen.queryByText("No current Stripe subscription")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review plans" })).toBeNull();
    expect(within(screen.getByText("Current access").parentElement!).getByText("Pro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invoices and payment methods" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
  });

  it("does not fill missing contract details from the profile or the current offer", async () => {
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: { ...subscription, planId: null, cycle: null, status: "unknown-fixture" } });
    mount();
    expect(await screen.findAllByText("Unavailable")).toHaveLength(3);
    expect(within(screen.getByText("Current access").parentElement!).getByText("Pro")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Review plans" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh billing status" })).toBeNull();
    expect(screen.queryByText("Current access")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Stripe portal" }));
    expect(mocks.portal).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["en", "teacher"], ["es", "teacher"], ["en", "admin"], ["es", "admin"],
  ] as const)("preserves granted Enterprise access without assuming a paid subscription for %s/%s", async (locale, role) => {
    mocks.user.roles = [role];
    mocks.profile = { ...mocks.profile, currentPlanId: "plus" };
    mocks.billing.mockResolvedValue({ trialEligible: true, subscription: null });
    mount(locale);
    expect(await screen.findByText(locale === "en" ? "No current Stripe subscription" : "Sin suscripción actual en Stripe")).toBeInTheDocument();
    expect(within(screen.getByText(locale === "en" ? "Current access" : "Acceso actual").parentElement!).getByText("Enterprise")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start subscription|Iniciar suscripción|Manage subscription|Gestionar suscripción/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Review plans" : "Revisar planes" }));
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing?tab=subscriptions", { scroll: false });
    expect(mocks.portal).not.toHaveBeenCalled();
  });

  it.each(["missing profile", "missing plan", "profile read error"])("does not infer default access from %s or copy the Stripe plan into access", async (scenario) => {
    mocks.profileStream.mockImplementation((_uid, next, error) => {
      if (scenario === "profile read error") error(new Error("private profile error"));
      else next(scenario === "missing profile" ? null : { ...mocks.profile, currentPlanId: undefined });
      return vi.fn();
    });
    mount();
    expect(await screen.findByText("Basic")).toBeInTheDocument();
    expect(within(screen.getByText("Current access").parentElement!).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Default access")).toBeNull();
  });

  it.each([
    { currentPlanId: "basic" },
    { stripeCustomerId: "another-customer-fixture" },
    { updatedAt: "2026-11-03T20:01:00Z" },
  ])("refreshes once after a relevant profile update: %j", async (change) => {
    mocks.billing.mockResolvedValueOnce({ trialEligible: false, subscription: null });
    mount();
    await screen.findByText("No current Stripe subscription");
    await act(async () => mocks.profileStream.mock.calls[0][1]({ ...mocks.profile, ...change }));
    expect(await screen.findByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
    expect(within(screen.getByText("Stripe subscription").parentElement!).getByText("Basic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review plans" })).toBeNull();
    expect(mocks.billing).toHaveBeenCalledTimes(2);
    await act(async () => mocks.profileStream.mock.calls[0][1]({ ...mocks.profile, ...change }));
    expect(mocks.billing).toHaveBeenCalledTimes(2);
  });

  it("ignores an old response after a newer profile snapshot and shows loading during refresh", async () => {
    let resolveOld!: (value: PlanBillingState) => void;
    let resolveNew!: (value: PlanBillingState) => void;
    mocks.billing
      .mockResolvedValueOnce({ trialEligible: false, subscription: null })
      .mockReturnValueOnce(new Promise<PlanBillingState>((done) => { resolveOld = done; }))
      .mockReturnValueOnce(new Promise<PlanBillingState>((done) => { resolveNew = done; }));
    mount();
    await screen.findByText("No current Stripe subscription");
    fireEvent.click(screen.getByRole("button", { name: "Refresh billing status" }));
    expect(screen.getByRole("button", { name: "Refresh billing status" })).toBeDisabled();
    expect(screen.queryByText("No current Stripe subscription")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review plans" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh billing status" }));
    expect(mocks.billing).toHaveBeenCalledTimes(2);
    await act(async () => mocks.profileStream.mock.calls[0][1]({ ...mocks.profile, updatedAt: "2026-11-03T20:01:00Z" }));
    await act(async () => resolveNew({ trialEligible: false, subscription }));
    await act(async () => resolveOld({ trialEligible: false, subscription: null }));
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
    expect(screen.queryByText("No current Stripe subscription")).toBeNull();
    expect(mocks.billing).toHaveBeenCalledTimes(3);
  });

  it.each(["en", "es"] as const)("retries an unreadable subscription explicitly in %s without changing profile access", async (locale) => {
    mocks.billing.mockRejectedValueOnce(new Error("private read failure"));
    mount(locale);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Refresh billing status" : "Actualizar estado de facturación" }));
    expect(await screen.findByRole("button", { name: locale === "en" ? "Manage subscription" : "Gestionar suscripción" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(mocks.billing).toHaveBeenCalledTimes(2);
  });

  it("does not poll while waiting for a webhook", async () => {
    vi.useFakeTimers();
    mocks.billing.mockResolvedValue({ trialEligible: false, subscription: null });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.billing).toHaveBeenCalledTimes(1);
  });
});
