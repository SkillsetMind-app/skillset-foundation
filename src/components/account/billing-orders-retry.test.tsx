import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { Order } from "@/domain/order";

// F-11: o resumo e as compras vêm de uma leitura só (subscribeToUserOrders).
// Quando ela falha, o aviso ganha "Try again", que assina de novo; nunca um
// "No purchases yet" ou valores zerados no lugar do erro.
type Read = { next: (orders: Order[]) => void; fail: (error: Error) => void };

const mocks = vi.hoisted(() => ({
  // Objeto estável: um novo a cada render reassinaria a leitura.
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
])("Billing › %s com a leitura das compras falhando", (tab, loading, loaded) => {
  it("mostra o aviso com 'Try again', assina de novo uma vez e o aviso sai quando a leitura responde", async () => {
    mocks.tab = tab;
    render(<I18nProvider initialLocale="en"><BillingTabs /></I18nProvider>);
    expect(mocks.reads).toHaveLength(1);

    act(() => mocks.reads[0].fail(new Error("offline")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your purchases.");
    // Nada de vazio nem de zero no lugar do erro.
    expect(screen.queryByText("No purchases yet.")).toBeNull();
    expect(screen.queryByText("Lifetime spend")).toBeNull();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    // A assinatura anterior sai antes da nova, e só uma nova.
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
