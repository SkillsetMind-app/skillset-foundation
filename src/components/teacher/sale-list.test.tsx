import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/domain/order";

import { SaleList } from "./sale-list";

// O que a pessoa sofria: com zero pedidos a pagina de vendas trocava tudo por
// um card de vazio de 5 linhas. Sem periodo, sem busca, sem filtro, sem
// exportar — e sem dizer de QUE recorte ela estava falando. Com pedidos,
// devolver dinheiro exigia sair daqui e cacar o pagamento na Stripe na mao.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DAY = 24 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  // O MESMO objeto em todo render: um usuario novo por render reinscreve o
  // efeito e entra em laco.
  user: { uid: "teacher-1", displayName: "Patricia", roles: ["teacher"] },
  orders: [] as Order[],
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (
    _uid: string,
    onData: (orders: Order[]) => void,
  ) => {
    onData(mocks.orders);
    return () => undefined;
  },
}));

function order(overrides: Partial<Order>): Order {
  return {
    id: "order-1",
    userId: "buyer-1",
    teacherId: "teacher-1",
    courseId: "course-1",
    courseSlug: "facilitation",
    courseTitle: "Facilitation Fundamentals",
    amountMinor: 12000,
    currency: "USD",
    platformFeeBps: 0,
    status: "paid",
    provider: "stripe",
    checkoutSessionId: "cs_1",
    paymentIntentId: "pi_123",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mocks.orders = [];
});

describe("SaleList", () => {
  it("keeps the operating frame and names the period with zero orders", () => {
    render(<SaleList />);

    expect(screen.getByLabelText("Filter by period")).toHaveValue("30d");
    // A busca tinha min-w-0: a 390 px virava uma caixa de 35 px entre os dois
    // selects. Com um minimo ela quebra para a linha de baixo, inteira.
    expect(screen.getByLabelText("Search sales by course or order id")).toHaveClass(
      "min-w-[12rem]",
    );
    expect(screen.getByLabelText("Filter by status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();

    // A linha de contagem diz o recorte: "0 orders between <de> e <ate>".
    expect(screen.getByText(/^0 orders between .+ and .+$/)).toBeInTheDocument();

    // Vazio de 2 linhas, sem o paragrafo de 5 linhas sobre o modelo Stripe.
    expect(screen.getByText("No sales in this period.")).toBeInTheDocument();
    expect(
      screen.getByText("When a learner completes checkout, the order appears here."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to your courses" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/settlement and payout timing/i)).toBeNull();
  });

  it("gives every order the refund deep link and shows the refunded chip", () => {
    mocks.orders = [
      order({
        id: "order-1",
        paymentIntentId: "pi_123",
        createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
      }),
      order({
        id: "order-2",
        courseTitle: "Group Work",
        status: "refunded",
        paymentIntentId: "pi_456",
        createdAt: new Date(Date.now() - DAY).toISOString(),
      }),
    ];

    render(<SaleList />);

    expect(screen.getByText(/^2 orders between .+ and .+$/)).toBeInTheDocument();

    const refundLinks = screen.getAllByRole("link", { name: "Refund in Stripe" });
    expect(refundLinks).toHaveLength(2);
    expect(refundLinks.map((link) => link.getAttribute("href"))).toEqual([
      "https://dashboard.stripe.com/payments/pi_456",
      "https://dashboard.stripe.com/payments/pi_123",
    ]);

    // O chip, nao a opcao "Refunded" do filtro de status.
    expect(
      screen.getByText("Refunded", { selector: "span.status-chip" }),
    ).toHaveAttribute("data-status", "refunded");
    expect(screen.getByRole("button", { name: /export/i })).toBeEnabled();
  });
});
