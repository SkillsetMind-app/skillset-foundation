// A tela depois do cartao: confirma o teste gratis pela assinatura que o
// servidor devolve (nunca pela URL) e leva de volta ao estudio.
import { cleanup, render, screen } from "@testing-library/react";
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

beforeEach(() => mocks.billing.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("billing return status", () => {
  it("confirma o teste gratis com a data e o botao de volta ao estudio", async () => {
    mocks.billing.mockResolvedValue(trialing);
    show();

    expect(await screen.findByRole("heading", { name: "Your 14-day free trial has started." })).toBeInTheDocument();
    expect(screen.getByText(/It runs until October 20, 2026\. Cancel anytime in Billing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Teacher Studio" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("link", { name: "Back to billing" })).toHaveAttribute("href", "/account/billing?tab=overview");
  });

  it("em espanhol diz prueba gratis", async () => {
    mocks.billing.mockResolvedValue(trialing);
    show("es");
    expect(await screen.findByRole("heading", { name: "Tu prueba gratis de 14 días ha empezado." })).toBeInTheDocument();
  });

  it("plano pago sem teste: confirma o plano, sem falar em teste", async () => {
    mocks.billing.mockResolvedValue({
      trialEligible: false,
      subscription: { ...trialing.subscription!, status: "active", trialEnd: null },
    });
    show();
    expect(await screen.findByRole("heading", { name: "Your plan is active." })).toBeInTheDocument();
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();
  });

  it("enquanto a assinatura nao aparece, espera; se nao vier, cai no texto de conferir em Billing", async () => {
    vi.useFakeTimers();
    mocks.billing.mockResolvedValue({ trialEligible: true, subscription: null });
    show();

    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole("heading", { name: "Confirming your plan…" })).toBeInTheDocument();
    // Nada confirma sem assinatura: nem titulo de sucesso, nem botao do estudio.
    expect(screen.queryByRole("link", { name: "Open Teacher Studio" })).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(3000 * 15);
    expect(screen.getByRole("heading", { name: "Review your subscription status." })).toBeInTheDocument();
    expect(mocks.billing).toHaveBeenCalledTimes(15);
    expect(screen.getByRole("link", { name: "Back to billing" })).toBeInTheDocument();
  });

  it("a assinatura que chega na segunda leitura confirma o teste", async () => {
    vi.useFakeTimers();
    mocks.billing
      .mockResolvedValueOnce({ trialEligible: true, subscription: null })
      .mockResolvedValue(trialing);
    show();

    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole("heading", { name: "Confirming your plan…" })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByRole("heading", { name: "Your 14-day free trial has started." })).toBeInTheDocument();
  });
});
