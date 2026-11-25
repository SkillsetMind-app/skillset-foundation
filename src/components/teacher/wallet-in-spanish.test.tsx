import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

// What the person suffered: with the interface in Spanish, the teacher's wallet
// stayed 100% in English — header, balance, Stripe status, the four
// tiles, the statements and every ledger row. This proof renders the panel
// inside the I18nProvider in "es" and checks, literal by literal, that none of the
// old texts is left and that the new Spanish ones appear.

// STABLE references on purpose: the panel subscribes to profile and ledger with
// `[user]` in the dependency and keeps the result in state. Returning a new object
// on every render reruns the effect, which changes the state, which renders again — a
// synchronous loop inside React's act() that not even the testTimeout interrupts.
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

// The teacher's products (the name on each statement row) do not come here.
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({
  loadTeacherInbox: () => Promise.resolve({ courses: [], questions: [], threads: 0 }),
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: () =>
    Promise.resolve({ chargesEnabled: false, payoutsEnabled: false }),
}));

// Stripe's embedded onboarding has its own asynchronous initialization and brings
// Stripe's own text, which is not ours to translate.
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

afterEach(cleanup);

// The literals of the English screen (today's and those that already went away). If any
// shows up with the screen in Spanish, the proof fails.
const OLD_ENGLISH = [
  "Payouts & tax",
  "Your earnings, your payout setup",
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
  "Order #ORD-1",
  "Payment pay-1",
  "Recorded",
];

describe("teacher wallet in Spanish", () => {
  it("none of the old English texts is left", () => {
    render(
      <I18nProvider initialLocale="es">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    for (const literal of OLD_ENGLISH) {
      expect(
        screen.queryAllByText(literal),
        `old text: ${literal}`,
      ).toHaveLength(0);
    }
  });

  // The list above only proves something if the English screen shows these texts today:
  // the title and the statement row changed in this package, and the list changed with them.
  it("the list literals appear on the English screen", () => {
    render(
      <I18nProvider initialLocale="en">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Your earnings, your payout setup" })).toBeInTheDocument();
    expect(screen.getByText("Order #ORD-1")).toBeInTheDocument();
  });

  it("shows the header, the balance, the Stripe status and the tiles in Spanish", () => {
    render(
      <I18nProvider initialLocale="es">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    // Header and balance card.
    // The label "Ganancias" above the title only repeated the bar's name: it went away,
    // like on the sibling screens. The h1 is only the title, with no period and no "?" inside.
    expect(screen.queryByText("Ganancias", { selector: "p" })).toBeNull();
    expect(screen.queryByText("Pagos e impuestos")).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Tus ganancias, tu configuración de pagos",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Stripe recoge tus datos fiscales")).toBeInTheDocument();
    expect(screen.getByText("Neto estimado del creador")).toBeInTheDocument();
    expect(screen.getByText("Reembolsado")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Completar la configuración de pagos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver ventas" })).toBeInTheDocument();

    // Payout destination card.
    expect(screen.getByText("Destino de los pagos")).toBeInTheDocument();
    // The title was a fixed "Stripe Connect" in the code, in every language: Stripe's
    // product name, not what the person has.
    // h2 right below the page's h1 (before it jumped to h3).
    expect(screen.getByRole("heading", { level: 2, name: "Tu cuenta de Stripe" })).toBeInTheDocument();
    expect(screen.queryByText("Stripe Connect")).toBeNull();
    expect(screen.getByText("Sin conectar")).toBeInTheDocument();
    // With no account, the three status rows ("Sin crear", "Pendiente",
    // "Pendiente") do not appear: they only repeated the "Sin conectar" badge.
    for (const row of ["Cuenta conectada", "Sin crear", "Cobros", "Pendiente"]) {
      expect(screen.queryByText(row), row).toBeNull();
    }
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

    // Stripe setup still pending.
    expect(screen.getByText("Configurar los pagos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Completa la configuración de Stripe antes de vender cursos de pago.",
      }),
    ).toBeInTheDocument();
  });

  it("with the account created, the status rows appear in Spanish and there is only one refresh button", () => {
    const profile = mocks.profile;
    mocks.profile = { stripeConnectedAccountId: "acct_1234567890" };
    try {
      render(
        <I18nProvider initialLocale="es">
          <TeacherWalletPanel />
        </I18nProvider>,
      );

      expect(screen.getByText("Cuenta conectada")).toBeInTheDocument();
      expect(screen.getByText("Cobros")).toBeInTheDocument();
      // "Pendiente" appears in the charges and in the payouts.
      expect(screen.getAllByText("Pendiente")).toHaveLength(2);
      expect(screen.queryByText("Sin crear")).toBeNull();
      cleanup();

      // Account ready: there used to be two refresh buttons (on the balance and on the account).
      mocks.profile = {
        stripeConnectedAccountId: "acct_1234567890",
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: true,
      };
      render(
        <I18nProvider initialLocale="es">
          <TeacherWalletPanel />
        </I18nProvider>,
      );
      expect(screen.getAllByRole("button", { name: /^Actualizar/ })).toHaveLength(1);
    } finally {
      mocks.profile = profile;
    }
  });

  it("shows the statements and the ledger row in Spanish", () => {
    render(
      <I18nProvider initialLocale="es">
        <TeacherWalletPanel />
      </I18nProvider>,
    );

    expect(screen.getByText("Extractos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Registro de ingresos reciente." }),
    ).toBeInTheDocument();
    // The "Exportar tras el primer pago" was disabled forever: it went away.
    expect(
      screen.queryByRole("button", { name: "Exportar tras el primer pago" }),
    ).toBeNull();
    // With no connected Stripe account, "Abrir mi Stripe" only gave an error: it does not appear.
    expect(screen.queryByRole("button", { name: "Abrir mi Stripe" })).toBeNull();

    // The ledger row itself: the short order code (without the product name,
    // which was not read here) and the status; the payment id went away.
    expect(screen.getByText("Pedido #ORD-1")).toBeInTheDocument();
    expect(screen.queryByText("Pago pay-1")).toBeNull();
    expect(screen.getByText("Registrado")).toBeInTheDocument();
    // Date and amount in the screen's language: the date always came out in English and the net
    // as "USD 42.38".
    expect(screen.queryByText("Sep 1, 2026")).toBeNull();
    expect(screen.getByText(/^1 sept?\.? 2026$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^42,38\sUS\$$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/USD 42\.38/)).toBeNull();

    expect(screen.getByText("Centro fiscal")).toBeInTheDocument();
  });

  // With no movement there is no currency to assert: the net says just "0" (with
  // movement in a single currency, the zero comes out in it; see creator-ops.test).
  it("with no sales, the estimated net says 0 without inventing a currency", () => {
    const ledger = mocks.ledger;
    mocks.ledger = [];
    try {
      render(
        <I18nProvider initialLocale="es">
          <TeacherWalletPanel />
        </I18nProvider>,
      );

      const net = screen.getByText("Neto estimado del creador").nextElementSibling;
      expect(net).toHaveTextContent(/^0$/);
      expect(screen.queryByText(/^0,00\sUS\$$/)).toBeNull();
    } finally {
      mocks.ledger = ledger;
    }
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
