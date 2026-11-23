import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";
import { I18nProvider } from "@/components/i18n/i18n-provider";

// Billing › Overview quando o PERFIL não carrega: a frase mandava atualizar a
// página e não tinha botão. Agora o aviso ganha "Try again", que assina a
// leitura do perfil de novo, uma vez só.
type Read = { next: (profile: { stripeCustomerId?: string } | null) => void; fail: (error: Error) => void };

const mocks = vi.hoisted(() => ({
  // Objeto estável: um novo a cada render reassinaria a leitura.
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

describe("Billing › Overview com a leitura do perfil falhando", () => {
  it("mostra 'Try again', assina o perfil de novo uma vez e o portal aparece", () => {
    renderBilling();
    expect(mocks.reads).toHaveLength(1);
    act(() => mocks.reads[0].fail(new Error("offline")));

    expect(screen.getByText("We couldn't load your billing details right now.")).toBeInTheDocument();
    expect(screen.queryByText(/Refresh to try again/)).toBeNull();
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    // Lendo: o esqueleto de sempre, e só uma assinatura nova.
    expect(screen.getByRole("status")).toHaveTextContent("Loading your billing overview...");
    expect(mocks.reads).toHaveLength(2);

    act(() => mocks.reads[1].next({ stripeCustomerId: "cus_1" }));
    expect(screen.getByRole("button", { name: "Open Stripe portal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.reads).toHaveLength(2);
  });

  it("o erro de abrir o portal não ganha 'Try again'", async () => {
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
