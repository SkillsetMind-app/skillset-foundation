// The screen after the card: confirms the free trial from the subscription the
// server returns (never from the URL) and leads back to the studio.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingReturnStatus } from "@/components/account/billing-return-status";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { PlanBillingState } from "@/lib/payments/billing";

const mocks = vi.hoisted(() => ({ billing: vi.fn<() => Promise<PlanBillingState>>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/payments/billing", () => ({ fetchPlanBillingState: mocks.billing }));

const trialing: PlanBillingState = {
  trialEligible: false,
  subscription: {
    planId: "pro",
    cycle: "monthly",
    status: "trialing",
    trialEnd: "2026-10-20T16:00:00.000Z",
    currentPeriodEnd: "2026-10-20T16:00:00.000Z",
    cancelAtPeriodEnd: false,
  },
};

const show = (locale: "en" | "es" = "en") =>
  render(
    <I18nProvider initialLocale={locale}>
      <BillingReturnStatus />
    </I18nProvider>,
  );

// The fake clock advances inside act: without it React does not redraw in the test.
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => mocks.billing.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("billing return status", () => {
  it("confirms the free trial with the date and the button back to the studio", async () => {
    mocks.billing.mockResolvedValue(trialing);
    show();

    expect(await screen.findByRole("heading", { name: "Your 14-day free trial has started." })).toBeInTheDocument();
    expect(screen.getByText(/It runs until October 20, 2026\. Cancel anytime in Billing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Teacher Studio" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("link", { name: "Back to billing" })).toHaveAttribute("href", "/account/billing?tab=overview");
  });

  it("in Spanish it says prueba gratis", async () => {
    mocks.billing.mockResolvedValue(trialing);
    show("es");
    expect(await screen.findByRole("heading", { name: "Tu prueba gratis de 14 días ha empezado." })).toBeInTheDocument();
  });

  it("paid plan without a trial: confirms the plan, without mentioning a trial", async () => {
    mocks.billing.mockResolvedValue({
      trialEligible: false,
      subscription: { ...trialing.subscription!, status: "active", trialEnd: null },
    });
    show();
    expect(await screen.findByRole("heading", { name: "Your plan is active." })).toBeInTheDocument();
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();
  });

  it("while the subscription does not show up, it waits; if it never comes, it falls back to the text to check in Billing", async () => {
    vi.useFakeTimers();
    mocks.billing.mockResolvedValue({ trialEligible: true, subscription: null });
    show();

    await tick(0);
    expect(screen.getByRole("heading", { name: "Confirming your plan..." })).toBeInTheDocument();
    // Nothing confirms without a subscription: no success title, no studio button.
    expect(screen.queryByRole("link", { name: "Open Teacher Studio" })).not.toBeInTheDocument();

    await tick(3000 * 15);
    expect(screen.getByRole("heading", { name: "Review your subscription status." })).toBeInTheDocument();
    expect(mocks.billing).toHaveBeenCalledTimes(15);
    // Same card as the other return screens: the main action is the only
    // filled one, and support appears when the confirmation did not arrive.
    expect(screen.getByRole("link", { name: "Back to billing" })).toHaveClass("button-solid");
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/support");
  });

  it("the subscription that arrives on the second read confirms the trial", async () => {
    vi.useFakeTimers();
    mocks.billing
      .mockResolvedValueOnce({ trialEligible: true, subscription: null })
      .mockResolvedValue(trialing);
    show();

    await tick(0);
    expect(screen.getByRole("heading", { name: "Confirming your plan..." })).toBeInTheDocument();
    await tick(3000);
    expect(screen.getByRole("heading", { name: "Your 14-day free trial has started." })).toBeInTheDocument();
  });
});
