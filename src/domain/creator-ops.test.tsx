import { describe, expect, it } from "vitest";

import {
  buildCreatorOpsSnapshot,
  summarizeCreatorSales,
  summarizeCreatorWallet,
} from "@/domain/creator-ops";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

describe("creator-ops rollup", () => {
  it("sums paid sales preferring BRL", () => {
    const orders = [
      { id: "1", status: "paid", amountMinor: 1000, currency: "USD" },
      { id: "2", status: "paid", amountMinor: 5000, currency: "BRL" },
      { id: "3", status: "refunded", amountMinor: 9999, currency: "BRL" },
    ] as Order[];
    expect(summarizeCreatorSales(orders)).toEqual({
      salesCount: 2,
      salesGrossMinor: 5000,
      salesCurrency: "BRL",
    });
  });

  it("splits wallet ledger by status", () => {
    const ledgers = [
      { id: "a", status: "in_release", netAmountMinor: 100 },
      { id: "b", status: "released", netAmountMinor: 250 },
    ] as PayoutLedgerEntry[];
    expect(summarizeCreatorWallet(ledgers)).toEqual({
      walletInReleaseMinor: 100,
      walletReleasedMinor: 250,
    });
  });

  it("builds full ops snapshot", () => {
    const snap = buildCreatorOpsSnapshot({
      orders: [{ id: "1", status: "paid", amountMinor: 2000, currency: "USD" }] as Order[],
      ledgers: [{ id: "a", status: "released", netAmountMinor: 1800 }] as PayoutLedgerEntry[],
      subscriptionMetrics: {
        activeCount: 3,
        pastDueCount: 1,
        cancelScheduledCount: 0,
        canceledLast30Days: 0,
        observedChurnRate: 0,
        mrrByCurrency: [{ currency: "USD", amountMinor: 9900 }],
      },
    });
    expect(snap.activeSubscribers).toBe(3);
    expect(snap.pastDueSubscribers).toBe(1);
    expect(snap.mrrMinor).toBe(9900);
    expect(snap.walletReleasedMinor).toBe(1800);
    expect(snap.salesCount).toBe(1);
  });
});
