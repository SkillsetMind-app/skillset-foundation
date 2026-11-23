import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

// O que o professor novo via em Ganhos: o bloco da conta vazio ate o
// formulario cair, o extrato numa frase dentro de uma caixa, "Order {uuid}" e
// "Payment pi_..." em cada linha, e falha de leitura sem saida (so recarregar
// a pagina), dita duas vezes. O "?" da ajuda morava dentro do h1.

// Referencias ESTAVEIS: o painel assina perfil e ledger com `[user]`.
const mocks = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  profile: { mode: "data" as "pending" | "data" | "error", value: {} as Record<string, unknown> },
  ledger: { mode: "data" as "pending" | "data" | "error", value: [] as PayoutLedgerEntry[] },
  onProfile: null as null | ((profile: Record<string, unknown>) => void),
  onLedger: null as null | ((entries: PayoutLedgerEntry[]) => void),
  reloadProfile: vi.fn(),
  reloadLedger: vi.fn(),
  inbox: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
    onError: (error: Error) => void,
  ) => {
    mocks.onProfile = onData;
    if (mocks.profile.mode === "data") onData(mocks.profile.value);
    if (mocks.profile.mode === "error") onError(new Error("profile read failed"));
    return Object.assign(() => undefined, { reload: mocks.reloadProfile });
  },
}));
vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (
    _uid: string,
    onData: (entries: PayoutLedgerEntry[]) => void,
    onError: (error: Error) => void,
  ) => {
    mocks.onLedger = onData;
    if (mocks.ledger.mode === "data") onData(mocks.ledger.value);
    if (mocks.ledger.mode === "error") onError(new Error("ledger read failed"));
    return Object.assign(() => undefined, { reload: mocks.reloadLedger });
  },
}));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ loadTeacherInbox: mocks.inbox }));
vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: mocks.refresh,
}));
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

const entry: PayoutLedgerEntry = {
  id: "l1",
  teacherId: "teacher-1",
  courseId: "course-1",
  orderId: "3f8e2b6c-41d7-4a9e-9c55-2b1e7d0a6f13",
  paymentId: "pi_3QxYz8Lk2mN4aB7c",
  grossAmountMinor: 4900,
  skillsetFeeMinor: 490,
  stripeFeeMinor: 172,
  netAmountMinor: 4238,
  currency: "USD",
  status: "settled",
  createdAt: "2026-11-18T12:00:00.000Z",
};

function mount(locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}><TeacherWalletPanel /></I18nProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mode = "data";
  mocks.profile.value = {};
  mocks.ledger.mode = "data";
  mocks.ledger.value = [];
  mocks.inbox.mockResolvedValue({ courses: [], questions: [], threads: 0 });
  mocks.refresh.mockResolvedValue({ chargesEnabled: false, payoutsEnabled: false });
  mocks.reloadProfile.mockResolvedValue(undefined);
  mocks.reloadLedger.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("ganhos: cabecalho das telas irmas", () => {
  it.each(["en", "es"] as const)("o h1 e so o titulo, sem ponto final, e o '?' fica ao lado (%s)", async (locale) => {
    mount(locale);
    await act(async () => {});
    const title = locale === "en" ? "Your earnings, your payout setup" : "Tus ganancias, tu configuración de pagos";
    // Nome exato: com o botao dentro, o nome do h1 levava "Help about ...".
    const heading = screen.getByRole("heading", { level: 1, name: title });
    expect(within(heading).queryByRole("button")).toBeNull();
    const help = screen.getByRole("button", {
      name: locale === "en" ? "Help about Payout schedule" : "Ayuda sobre Calendario de pagos",
    });
    expect(heading.parentElement).toContainElement(help);
    // O rotulo "Earnings" em cima so repetia o nome da barra.
    expect(screen.queryByText(locale === "en" ? "Earnings" : "Ganancias", { selector: "p" })).toBeNull();
  });
});

describe("ganhos: bloco da conta de pagamentos", () => {
  it("enquanto o perfil chega, o bloco tem a forma do primeiro passo, sem formulario", async () => {
    mocks.profile.mode = "pending";
    mount();
    await act(async () => {});
    const connect = document.getElementById("stripe-connect")!;
    const waiting = within(connect).getByRole("status");
    expect(waiting).toHaveTextContent("Checking your payout account...");
    expect(waiting.querySelectorAll(".animate-pulse").length).toBeGreaterThan(2);
    expect(screen.queryByTestId("stripe-onboarding")).toBeNull();
  });

  it("perfil que falha: um aviso so, no bloco, com Try again que le de novo", async () => {
    mocks.profile.mode = "error";
    mount();
    await act(async () => {});
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("We could not load your payout profile.");
    expect(document.getElementById("stripe-connect")).toContainElement(alerts[0]);
    // Sem perfil nao se sabe se ha conta: o selo nao diz "Not connected".
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("stripe-onboarding")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reloadProfile).toHaveBeenCalledTimes(1);
    await act(async () => {
      mocks.onProfile?.({});
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("stripe-onboarding")).toBeInTheDocument();
  });

  it("a falha de atualizar a conta e o aviso de erro da casa; o sucesso, o de status", async () => {
    mount();
    // A conferencia silenciosa da visita ja passou; daqui em diante, o clique.
    await act(async () => {});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    mocks.refresh.mockRejectedValueOnce(new Error(""));
    fireEvent.click(screen.getByRole("button", { name: "Refresh account status" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("We could not refresh Stripe payout status.");

    mocks.refresh.mockResolvedValueOnce({ chargesEnabled: true, payoutsEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Refresh account status" }));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Stripe charges and payouts are ready for this teacher account.").closest("[role=status]"))
      .not.toBeNull();
  });
});

describe("ganhos: extrato", () => {
  it("enquanto o registro chega, linhas no formato do extrato, nao uma frase", async () => {
    mocks.ledger.mode = "pending";
    mount();
    await act(async () => {});
    const statements = screen.getByRole("heading", { level: 2, name: "Recent earnings record." }).closest("section")!;
    const waiting = within(statements).getByRole("status");
    expect(waiting).toHaveTextContent("Loading your earnings record...");
    expect(waiting.querySelectorAll("[aria-hidden=true]")).toHaveLength(3);
  });

  it("cada linha diz o produto e o codigo curto do pedido, sem o id do pagamento", async () => {
    mocks.ledger.value = [entry];
    mocks.inbox.mockResolvedValue({ courses: [{ id: "course-1", title: "Stress Reset Program", communityEnabled: false }], questions: [], threads: 0 });
    mount();
    await act(async () => {});
    const row = screen.getByRole("link", { name: /Stress Reset Program/ });
    expect(row).toHaveAttribute("href", `/teach/sales/${entry.orderId}`);
    expect(within(row).getByText("Order #7D0A6F13")).toBeInTheDocument();
    expect(row).not.toHaveTextContent(entry.orderId);
    expect(row).not.toHaveTextContent("pi_3QxYz8Lk2mN4aB7c");
  });

  it("sem o nome do produto, a linha fica com o codigo curto, como em Vendas", async () => {
    mocks.ledger.value = [entry];
    mocks.inbox.mockRejectedValue(new Error("inbox read failed"));
    mount("es");
    await act(async () => {});
    const row = screen.getByRole("link", { name: /Pedido #7D0A6F13/ });
    expect(row).not.toHaveTextContent("pi_3QxYz8Lk2mN4aB7c");
  });

  it("registro que falha: um aviso so, no extrato, com Try again; os numeros dizem Unavailable", async () => {
    mocks.ledger.mode = "error";
    mount();
    await act(async () => {});
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("We could not load your earnings record.");
    const statements = screen.getByRole("heading", { level: 2, name: "Recent earnings record." }).closest("section")!;
    expect(statements).toContainElement(alerts[0]);
    expect(screen.queryByText("$0.00")).toBeNull();

    fireEvent.click(within(statements).getByRole("button", { name: "Try again" }));
    expect(mocks.reloadLedger).toHaveBeenCalledTimes(1);
    await act(async () => {
      mocks.onLedger?.([entry]);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: /Order #7D0A6F13/ })).toBeInTheDocument();
  });
});
