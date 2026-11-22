import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  subscribeToTeacherCourseSubscriptions: vi.fn(),
  subscribeToTeacherOrders: vi.fn(),
  subscribeToTeacherPayoutLedger: vi.fn(),
  subscribeToTeacherCourses: vi.fn(),
  subscribeToUserProfile: vi.fn(),
  refreshTeacherStripeAccountStatus: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: dataMocks.user }),
}));

vi.mock("@/lib/data/course-subscriptions", () => ({
  subscribeToTeacherCourseSubscriptions:
    dataMocks.subscribeToTeacherCourseSubscriptions,
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: dataMocks.subscribeToTeacherOrders,
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: dataMocks.subscribeToTeacherPayoutLedger,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: dataMocks.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: dataMocks.subscribeToUserProfile,
}));

vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus:
    dataMocks.refreshTeacherStripeAccountStatus,
}));

vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div>Connect onboarding</div>,
}));

import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import {
  buildCreatorOpsSnapshot,
  summarizeCreatorSales,
  summarizeCreatorWallet,
} from "@/domain/creator-ops";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

beforeEach(() => {
  vi.clearAllMocks();
  dataMocks.subscribeToTeacherCourseSubscriptions.mockImplementation(
    (_teacherId, callback) => {
      callback([]);
      return () => undefined;
    },
  );
  dataMocks.subscribeToTeacherOrders.mockImplementation(
    (_teacherId, callback) => {
      callback([]);
      return () => undefined;
    },
  );
  dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(
    (_teacherId, callback) => {
      callback([]);
      return () => undefined;
    },
  );
  dataMocks.subscribeToTeacherCourses.mockImplementation(
    (_teacherId, callback) => {
      callback([]);
      return () => undefined;
    },
  );
  dataMocks.subscribeToUserProfile.mockImplementation(
    (_userId, callback) => {
      callback(null);
      return () => undefined;
    },
  );
  dataMocks.refreshTeacherStripeAccountStatus.mockResolvedValue({
    chargesEnabled: false,
    payoutsEnabled: false,
    payoutsUnavailable: false,
  });
});

describe("creator-ops rollup", () => {
  it("keeps paid sales totals separated by currency", () => {
    const orders = [
      { id: "1", status: "paid", amountMinor: 1000, currency: "USD" },
      { id: "2", status: "paid", amountMinor: 5000, currency: "BRL" },
      { id: "3", status: "refunded", amountMinor: 9999, currency: "BRL" },
    ] as Order[];
    expect(summarizeCreatorSales(orders)).toEqual({
      salesCount: 2,
      salesGrossByCurrency: [
        { currency: "BRL", amountMinor: 5000 },
        { currency: "USD", amountMinor: 1000 },
      ],
    });
  });

  // Reembolso parcial: a venda de $100 com $30 devolvidos conta $70.
  it("counts a partially refunded sale for what the teacher kept", () => {
    const orders = [
      { id: "1", status: "partially_refunded", amountMinor: 10_000, refundedAmountMinor: 3_000, currency: "USD" },
      { id: "2", status: "refunded", amountMinor: 9_999, refundedAmountMinor: 9_999, currency: "USD" },
    ] as Order[];
    expect(summarizeCreatorSales(orders)).toEqual({
      salesCount: 1,
      salesGrossByCurrency: [{ currency: "USD", amountMinor: 7_000 }],
    });
  });

  it("counts a settled row — the only status direct charges write — in net and sales", () => {
    const ledgers = [
      {
        id: "settled-1",
        status: "settled",
        grossAmountMinor: 12_000,
        skillsetFeeMinor: 1_000,
        stripeFeeMinor: 1_000,
        netAmountMinor: 10_000,
        currency: "USD",
      },
    ] as PayoutLedgerEntry[];
    const summary = summarizeCreatorWallet(ledgers);
    expect(summary.salesCount).toBe(1);
    expect(summary.teacherNetByCurrency).toEqual([
      { currency: "USD", amountMinor: 10_000 },
    ]);
  });

  it("splits every earnings total by currency", () => {
    const ledgers = [
      {
        id: "a",
        status: "in_release",
        grossAmountMinor: 120,
        skillsetFeeMinor: 10,
        stripeFeeMinor: 10,
        netAmountMinor: 100,
        currency: "BRL",
      },
      {
        id: "b",
        status: "releasing",
        grossAmountMinor: 270,
        skillsetFeeMinor: 10,
        stripeFeeMinor: 10,
        netAmountMinor: 250,
        currency: "USD",
      },
      {
        id: "c",
        status: "released_advance",
        grossAmountMinor: 540,
        skillsetFeeMinor: 20,
        stripeFeeMinor: 20,
        netAmountMinor: 500,
        currency: "USD",
      },
    ] as PayoutLedgerEntry[];
    expect(summarizeCreatorWallet(ledgers)).toEqual({
      salesCount: 3,
      grossPaidByCurrency: [
        { currency: "BRL", amountMinor: 120 },
        { currency: "USD", amountMinor: 810 },
      ],
      platformFeeByCurrency: [
        { currency: "BRL", amountMinor: 10 },
        { currency: "USD", amountMinor: 30 },
      ],
      stripeFeeByCurrency: [
        { currency: "BRL", amountMinor: 10 },
        { currency: "USD", amountMinor: 30 },
      ],
      teacherNetByCurrency: [
        { currency: "BRL", amountMinor: 100 },
        { currency: "USD", amountMinor: 750 },
      ],
      refundedByCurrency: [],
    });
  });

  it("builds full ops snapshot", () => {
    const snap = buildCreatorOpsSnapshot({
      orders: [{ id: "1", status: "paid", amountMinor: 2000, currency: "USD" }] as Order[],
      ledgers: [{
        id: "a",
        status: "released",
        grossAmountMinor: 2000,
        skillsetFeeMinor: 200,
        netAmountMinor: 1800,
        currency: "USD",
      }] as PayoutLedgerEntry[],
      subscriptionMetrics: {
        activeCount: 3,
        pastDueCount: 1,
        cancelScheduledCount: 0,
        canceledLast30Days: 0,
        observedChurnRate: 0,
        mrrByCurrency: [{ currency: "USD", amountMinor: 9900 }],
        mrrSnapshotMissingCount: 0,
        mrrLegacyFallbackCount: 0,
      },
    });
    expect(snap.activeSubscribers).toBe(3);
    expect(snap.pastDueSubscribers).toBe(1);
    expect(snap.mrrByCurrency).toEqual([
      { currency: "USD", amountMinor: 9900 },
    ]);
    expect(snap.teacherNetByCurrency).toEqual([
      { currency: "USD", amountMinor: 1800 },
    ]);
    expect(snap.salesGrossByCurrency).toEqual([
      { currency: "USD", amountMinor: 2000 },
    ]);
    expect(snap.salesCount).toBe(1);
  });
});

describe("CreatorOpsHub read failures", () => {
  it("renders unavailable signals instead of valid-looking zeroes", async () => {
    const fail = (
      _teacherId: string,
      _callback: (value: unknown[]) => void,
      onError: (error: Error) => void,
    ) => {
      onError(new Error("read failed"));
      return () => undefined;
    };
    dataMocks.subscribeToTeacherOrders.mockImplementation(fail);
    dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(fail);
    dataMocks.subscribeToTeacherCourseSubscriptions.mockImplementation(fail);
    dataMocks.subscribeToTeacherCourses.mockImplementation(fail);

    render(<CreatorOpsHub />);

    expect((await screen.findAllByText("Unavailable")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
});

describe("TeacherWalletPanel money integrity", () => {
  it("renders mixed-currency ledger totals as a breakdown", async () => {
    dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(
      (_teacherId, callback) => {
        callback([
          {
            id: "brl",
            status: "released",
            grossAmountMinor: 12_000,
            skillsetFeeMinor: 1_000,
            stripeFeeMinor: 1_000,
            netAmountMinor: 10_000,
            refundedAmountMinor: 0,
            currency: "BRL",
          },
          {
            id: "usd",
            status: "in_release",
            grossAmountMinor: 2_500,
            skillsetFeeMinor: 250,
            stripeFeeMinor: 250,
            netAmountMinor: 2_000,
            refundedAmountMinor: 0,
            currency: "USD",
          },
        ]);
        return () => undefined;
      },
    );

    render(<TeacherWalletPanel />);

    // Cada moeda no proprio valor, formatada na lingua da tela e nunca
    // convertida nem somada: R$100 do BRL e US$20 do USD, lado a lado.
    expect(
      await screen.findByText("R$100.00 · $20.00"),
    ).toBeInTheDocument();
    expect(screen.queryByText("USD 120.00")).not.toBeInTheDocument();
    expect(screen.queryByText("$120.00")).not.toBeInTheDocument();
    expect(screen.queryByText("R$120.00")).not.toBeInTheDocument();
  });

  it("does not turn a failed ledger read into zero balances", async () => {
    dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(
      (_teacherId, _callback, onError) => {
        onError(new Error("ledger failed"));
        return () => undefined;
      },
    );

    render(<TeacherWalletPanel />);

    expect((await screen.findAllByText("Unavailable")).length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  // Linha antiga do ledger sem moeda: o dominio a soma sob "UNSPECIFIED", que o
  // Intl recusa com RangeError. Sem o recuo, /account/payments inteira caia na
  // tela de erro. A pagina abre e mostra cada valor.
  it("renders legacy rows with an unknown or empty currency instead of crashing", async () => {
    dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(
      (_teacherId, callback) => {
        callback([
          {
            id: "legacy",
            status: "released",
            grossAmountMinor: 1_200,
            skillsetFeeMinor: 100,
            stripeFeeMinor: 0,
            netAmountMinor: 1_100,
            refundedAmountMinor: 0,
            currency: "UNSPECIFIED",
          },
          {
            id: "blank",
            status: "released",
            grossAmountMinor: 600,
            skillsetFeeMinor: 50,
            stripeFeeMinor: 0,
            netAmountMinor: 550,
            refundedAmountMinor: 0,
            currency: "",
          },
        ]);
        return () => undefined;
      },
    );

    render(<TeacherWalletPanel />);

    // "" e "UNSPECIFIED" caem na mesma soma do dominio (moeda desconhecida).
    const net = (await screen.findByText("Creator net estimate")).nextElementSibling;
    expect(net).toHaveTextContent(/^UNSPECIFIED 16\.50$/);
    // Cada linha do extrato com o proprio valor.
    expect(screen.getByText("UNSPECIFIED 11.00")).toBeInTheDocument();
    expect(screen.getByText("5.50")).toBeInTheDocument();
  });

  // So reembolso em BRL: o neto vazio dizia "$0.00" ao lado de "R$100.00".
  it("writes an empty total in the one currency the teacher uses", async () => {
    dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(
      (_teacherId, callback) => {
        callback([
          {
            id: "refund",
            status: "refunded",
            grossAmountMinor: 10_000,
            skillsetFeeMinor: 0,
            stripeFeeMinor: 0,
            netAmountMinor: 10_000,
            refundedAmountMinor: 10_000,
            currency: "BRL",
          },
        ]);
        return () => undefined;
      },
    );

    render(<TeacherWalletPanel />);

    const net = (await screen.findByText("Creator net estimate")).nextElementSibling;
    expect(net).toHaveTextContent(/^R\$0\.00$/);
    expect(screen.getAllByText("R$100.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("with no ledger at all, an empty total reads 0 without assuming a currency", async () => {
    dataMocks.subscribeToTeacherPayoutLedger.mockImplementation(
      (_teacherId, callback) => {
        callback([]);
        return () => undefined;
      },
    );

    render(<TeacherWalletPanel />);

    const net = (await screen.findByText("Creator net estimate")).nextElementSibling;
    expect(net).toHaveTextContent(/^0$/);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});
