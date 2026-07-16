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

  it("splits every wallet total by both status and currency", () => {
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
      walletInReleaseByCurrency: [
        { currency: "BRL", amountMinor: 100 },
        { currency: "USD", amountMinor: 250 },
      ],
      walletReleasedByCurrency: [{ currency: "USD", amountMinor: 500 }],
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
    expect(snap.walletReleasedByCurrency).toEqual([
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

    expect(
      await screen.findByText("BRL 100.00 + USD 20.00"),
    ).toBeInTheDocument();
    expect(screen.queryByText("USD 120.00")).not.toBeInTheDocument();
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
});
