import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

// O que a pessoa sofria: com a interface em espanhol, a carteira do professor
// continuava 100% em ingles — cabecalho, saldo, estado da Stripe, os quatro
// tiles, os extratos e cada linha do ledger. Esta prova renderiza o painel
// dentro do I18nProvider em "es" e confere, literal por literal, que nenhum dos
// textos antigos sobrou e que os novos em espanhol aparecem.

// Referencias ESTAVEIS de proposito: o painel assina perfil e ledger com
// `[user]` na dependencia e guarda o resultado em estado. Devolver objeto novo
// a cada render refaz o efeito, que troca o estado, que renderiza de novo — um
// laco sincrono dentro do act() do React que nem o testTimeout interrompe.
const mocks = vi.hoisted(() => ({
  user: {
    uid: "teacher-1",
    email: "profe@example.com",
    displayName: "Profesora",
    emailVerified: true,
    photoURL: null,
    roles: ["teacher"] as string[],
  },
  profile: {} as Record<string, unknown>,
  ledger: [
    {
      id: "l1",
      teacherId: "teacher-1",
      courseId: "course-1",
      orderId: "ord-1",
      paymentId: "pay-1",
      grossAmountMinor: 4900,
      skillsetFeeMinor: 490,
      stripeFeeMinor: 172,
      netAmountMinor: 4238,
      currency: "USD",
      status: "settled",
      createdAt: "2026-09-01T12:00:00.000Z",
    },
  ] as PayoutLedgerEntry[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
  ) => {
    onData(mocks.profile);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (
    _uid: string,
    onData: (entries: PayoutLedgerEntry[]) => void,
  ) => {
    onData(mocks.ledger);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: () =>
    Promise.resolve({ chargesEnabled: false, payoutsEnabled: false }),
}));

// O onboarding embutido da Stripe tem inicializacao assincrona propria e traz
// texto da propria Stripe, que nao e nosso para traduzir.
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

afterEach(cleanup);

// Os literais que a tela mostrava antes deste PR. Se algum voltar, a prova cai.
const INGLES_ANTIGO = [
  "Payouts & tax",
  "Your earnings, your payout setup.",
  "Payout schedule",
  "Stripe issues your tax forms",
  "Creator net estimate",
  "Refunded",
  "Complete payout setup",
  "View sales",
  "Payout destination",
  "Not connected",
  "Connected account",
  "Not created",
  "Charges",
  "Payouts",
  "Pending",
  "Refresh account status",
  "Paid sales",
  "Gross sales",
  "Platform fee est.",
  "Stripe fee est.",
  "Set up payouts",
  "Complete Stripe onboarding before selling paid courses.",
  "Statements",
  "Recent earnings record.",
  "Export after first payout",
  "Tax center",
  "Order ord-1",
  "Payment pay-1",
  "Recorded",
];

describe("carteira do professor em espanhol", () => {
  it("nao sobra nenhum dos textos antigos em ingles", () => {
    render(
      <I18nProvider initialLocale="es">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    for (const literal of INGLES_ANTIGO) {
      expect(
        screen.queryAllByText(literal),
        `texto antigo: ${literal}`,
      ).toHaveLength(0);
    }
  });

  it("mostra o cabecalho, o saldo, o estado da Stripe e os tiles em espanhol", () => {
    render(
      <I18nProvider initialLocale="es">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    // Cabecalho e cartao do saldo.
    expect(screen.getByText("Pagos e impuestos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /Tus ingresos, tu configuración de pagos\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Stripe emite tus formularios fiscales")).toBeInTheDocument();
    expect(screen.getByText("Neto estimado del creador")).toBeInTheDocument();
    expect(screen.getByText("Reembolsado")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Completar la configuración de pagos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver ventas" })).toBeInTheDocument();

    // Cartao do destino dos pagamentos.
    expect(screen.getByText("Destino de los pagos")).toBeInTheDocument();
    expect(screen.getByText("Sin conectar")).toBeInTheDocument();
    expect(screen.getByText("Cuenta conectada")).toBeInTheDocument();
    expect(screen.getByText("Sin crear")).toBeInTheDocument();
    expect(screen.getByText("Cobros")).toBeInTheDocument();
    // "Pendiente" aparece nos cobros e nos pagos.
    expect(screen.getAllByText("Pendiente")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Actualizar el estado de la cuenta" }),
    ).toBeInTheDocument();

    // Os quatro tiles.
    for (const tile of [
      "Ventas pagadas",
      "Ventas brutas",
      "Comisión de la plataforma (est.)",
      "Comisión de Stripe (est.)",
    ]) {
      expect(screen.getByText(tile), tile).toBeInTheDocument();
    }

    // Configuracao da Stripe ainda pendente.
    expect(screen.getByText("Configurar los pagos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Completa la configuración de Stripe antes de vender cursos de pago.",
      }),
    ).toBeInTheDocument();
  });

  it("mostra os extratos e a linha do ledger em espanhol", () => {
    render(
      <I18nProvider initialLocale="es">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    expect(screen.getByText("Extractos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Registro de ingresos reciente." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exportar tras el primer pago" }),
    ).toBeInTheDocument();

    // A linha do proprio movimento: pedido, pagamento e situacao.
    expect(screen.getByText("Pedido ord-1")).toBeInTheDocument();
    expect(screen.getByText("Pago pay-1")).toBeInTheDocument();
    expect(screen.getByText("Registrado")).toBeInTheDocument();

    expect(screen.getByText("Centro fiscal")).toBeInTheDocument();
  });
});
