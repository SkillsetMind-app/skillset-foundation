import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/domain/order";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

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
  openStripe: vi.fn(),
  // A primeira leitura falha; o "Try again" le de novo pelo mesmo canal.
  ordersFail: false,
  reload: vi.fn(),
}));

vi.mock("@/lib/payments/connect", () => ({ openTeacherStripeDashboard: mocks.openStripe }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (
    _uid: string,
    onData: (orders: Order[]) => void,
    onError: (error: Error) => void,
  ) => {
    if (mocks.ordersFail) onError(new Error("orders down"));
    else onData(mocks.orders);
    return Object.assign(() => undefined, { reload: mocks.reload });
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
  mocks.openStripe.mockReset();
  mocks.ordersFail = false;
  mocks.reload.mockReset();
});

describe("SaleList", () => {
  // Falha nao e "sem vendas": o erro com "Try again", que le de novo pelo
  // mesmo canal (antes a saida era recarregar a pagina).
  it("a failed read shows the error with Try again, never the empty state", () => {
    mocks.ordersFail = true;
    render(<SaleList />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your sales.");
    expect(screen.queryByLabelText("Filter by period")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

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

    // Nenhuma venda nunca: a cena do recibo e uma frase so, sem o paragrafo
    // de 5 linhas sobre o modelo Stripe.
    expect(screen.getByRole("heading", { name: "Your sales will show up here." })).toBeInTheDocument();
    expect(document.querySelector('svg[data-scene="noSales"]')).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("link", { name: "Go to your products" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/settlement and payout timing/i)).toBeNull();
    // Sem nenhum pedido, "Open my Stripe" so podia devolver "conecte o Stripe".
    expect(screen.queryByRole("button", { name: "Open my Stripe" })).toBeNull();
    // E a frase que manda abrir o Stripe sai junto com o botao.
    expect(screen.queryByText(/Open your Stripe dashboard to find the payment/)).toBeNull();
  });

  it("names the period when there were sales, just not in it", () => {
    mocks.orders = [order({ id: "order-old", createdAt: new Date(Date.now() - 200 * DAY).toISOString() })];
    render(<SaleList />);

    expect(screen.getByText("No sales in this period.")).toBeInTheDocument();
    expect(
      screen.getByText("When a learner completes checkout, the order appears here."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your sales will show up here.")).toBeNull();
  });

  it("lists the orders as one table, newest first, each row opening its sale", () => {
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

    // Antes: 50 cartoes soltos, sem colunas. Agora uma tabela com cabecalho.
    const table = screen.getByRole("table", { name: "Your sales, newest first" });
    expect(
      within(table).getAllByRole("columnheader").map((head) => head.textContent),
    ).toEqual(["Product", "Order", "Status", "Date", "Amount", "Actions"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Group Work");
    expect(rows[0]).toHaveTextContent("#ORDER-2");
    // O produto e o cabecalho da linha e, de novo, o link da venda.
    const product = within(rows[0]).getByRole("rowheader");
    expect(within(product).getByRole("link", { name: "Group Work" })).toHaveAttribute("href", "/teach/sales/order-2");

    const viewLinks = within(table).getAllByRole("link", { name: /^View sale/ });
    expect(viewLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/teach/sales/order-2",
      "/teach/sales/order-1",
    ]);
    // A ajuda de reembolso aparece uma vez, acima; nao repetida em cada linha.
    expect(screen.queryByRole("link", { name: "Refund options" })).toBeNull();
    expect(screen.getAllByText(/Open your Stripe dashboard to find the payment/)).toHaveLength(1);

    // O chip, nao a opcao "Refunded" do filtro de status.
    expect(
      within(table).getByText("Refunded", { selector: "span.status-chip" }),
    ).toHaveAttribute("data-status", "refunded");
    expect(screen.getByRole("button", { name: /export/i })).toBeEnabled();
  });

  // Dinheiro: cada pedido na moeda dele, alinhado a direita, sem somar moedas.
  // Reembolso parcial mostra o valor cobrado (como antes) e o selo do estado.
  it("shows each amount in the order's own currency, right-aligned, with the refund state", () => {
    mocks.orders = [
      order({ id: "order-brl", amountMinor: 9900, currency: "BRL", createdAt: new Date(Date.now() - DAY).toISOString() }),
      order({
        id: "order-part",
        amountMinor: 12000,
        refundedAmountMinor: 3000,
        status: "partially_refunded",
        createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
      }),
    ];

    render(<SaleList />);

    const [brl, partial] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const brlAmount = within(brl).getByText(
      new Intl.NumberFormat("en", { style: "currency", currency: "BRL" }).format(99),
    );
    expect(brlAmount).toHaveClass("text-right", "num");
    expect(within(partial).getByText("$120.00")).toHaveClass("text-right");
    expect(within(partial).getByText("Partially refunded", { selector: "span.status-chip" })).toBeInTheDocument();
    expect(screen.queryByText(/\$219|\$90\.00/)).toBeNull();
  });

  // A 360px a tabela de 640px escondia o valor e o unico link na rolagem
  // lateral. Cartao estreito: cada venda vira um bloco com titulo-link, selo,
  // data e valor; a tabela so aparece quando o cartao tem largura para ela.
  it("in a narrow card, shows each sale as a short block with the link and the amount", () => {
    mocks.orders = [
      order({ id: "order-a", courseTitle: "Group Work", amountMinor: 4900, createdAt: new Date(Date.now() - DAY).toISOString() }),
      order({ id: "order-b", status: "partially_refunded", refundedAmountMinor: 1000, createdAt: new Date(Date.now() - 2 * DAY).toISOString() }),
    ];

    render(<SaleList />);

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("hidden", "@2xl:block");
    const list = screen.getAllByRole("list").find((item) => item.className.includes("@2xl:hidden"))!;
    expect(list).toBeDefined();
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByRole("link", { name: "Group Work" })).toHaveAttribute("href", "/teach/sales/order-a");
    expect(within(first).getByText("$49.00")).toHaveClass("num", "text-right");
    expect(within(second).getByText("$120.00")).toBeInTheDocument();
    expect(within(second).getByText("Partially refunded", { selector: "span.status-chip" })).toBeInTheDocument();
  });

  // A tabela mostra "#1A2B3C4D"; o id guardado nao tem "#". Colar o codigo
  // da tela tem que achar a venda, sem importar maiusculas.
  it("finds a sale by the short code shown in the table, with or without #", () => {
    mocks.orders = [
      order({ id: "order-abcd1234", courseTitle: "Group Work" }),
      order({ id: "order-ffff0000", courseTitle: "Other" }),
    ];

    render(<SaleList />);

    const search = screen.getByLabelText("Search sales by course or order id");
    for (const value of ["#ABCD1234", "abcd1234", " #abcd1234 "]) {
      fireEvent.change(search, { target: { value } });
      const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
      expect(rows, value).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("#ABCD1234");
    }
  });

  it.each(["en", "es"] as const)("opens the shared Stripe action only on click, with conditional refund guidance (%s)", async (locale) => {
    const dictionary = getDictionary(locale);
    mocks.orders = [order({})];
    render(<I18nProvider initialLocale={locale}><SaleList /></I18nProvider>);
    expect(mocks.openStripe).not.toHaveBeenCalled();
    expect(screen.getByText(translate(dictionary, "stripeDashboard.refundGuidance"))).toBeVisible();
    expect(screen.getByRole("link", { name: translate(dictionary, "stripeDashboard.refundSupport") })).toHaveAttribute("href", "/support");
    expect(document.querySelector('a[href^="https://dashboard.stripe.com"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: translate(dictionary, "stripeDashboard.open") }));
    await waitFor(() => expect(mocks.openStripe).toHaveBeenCalledTimes(1));
  });
});
