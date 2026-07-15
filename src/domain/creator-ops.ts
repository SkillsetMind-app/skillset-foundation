/**
 * Creator operations rollup — sales + subscriptions + wallet signals.
 * Pure domain helpers for the Teacher Operations hub (P5).
 */
import type { CreatorSubscriptionMetrics } from "@/domain/creator-subscriptions";
import { isPaidOrder, type Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

export type CreatorOpsSnapshot = {
  salesCount: number;
  salesGrossMinor: number;
  salesCurrency: string;
  walletInReleaseMinor: number;
  walletReleasedMinor: number;
  activeSubscribers: number;
  pastDueSubscribers: number;
  mrrMinor: number;
  mrrCurrency: string;
};

export function summarizeCreatorSales(
  orders: Order[],
): Pick<CreatorOpsSnapshot, "salesCount" | "salesGrossMinor" | "salesCurrency"> {
  const paid = orders.filter((order) => isPaidOrder(order.status));
  const byCurrency = new Map<string, number>();
  for (const order of paid) {
    const currency = String(order.currency || "USD").toUpperCase();
    const amount = Number(order.amountMinor ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  }
  // Prefer BRL if present, else first currency, else USD.
  const currency =
    (byCurrency.has("BRL") && "BRL")
    || [...byCurrency.keys()][0]
    || "USD";
  return {
    salesCount: paid.length,
    salesGrossMinor: byCurrency.get(currency) ?? 0,
    salesCurrency: currency,
  };
}

export function summarizeCreatorWallet(
  ledgers: PayoutLedgerEntry[],
): Pick<CreatorOpsSnapshot, "walletInReleaseMinor" | "walletReleasedMinor"> {
  let inRelease = 0;
  let released = 0;
  for (const entry of ledgers) {
    const net = Number(entry.netAmountMinor ?? 0);
    if (!Number.isFinite(net)) continue;
    const status = String(entry.status ?? "").toLowerCase();
    if (status === "in_release" || status === "pending" || status === "held") {
      inRelease += net;
    } else if (status === "released" || status === "paid" || status === "transferred") {
      released += net;
    }
  }
  return {
    walletInReleaseMinor: inRelease,
    walletReleasedMinor: released,
  };
}

export function buildCreatorOpsSnapshot(input: {
  orders: Order[];
  ledgers: PayoutLedgerEntry[];
  subscriptionMetrics: CreatorSubscriptionMetrics;
}): CreatorOpsSnapshot {
  const sales = summarizeCreatorSales(input.orders);
  const wallet = summarizeCreatorWallet(input.ledgers);
  const mrr = input.subscriptionMetrics.mrrByCurrency[0];
  return {
    ...sales,
    ...wallet,
    activeSubscribers: input.subscriptionMetrics.activeCount,
    pastDueSubscribers: input.subscriptionMetrics.pastDueCount,
    mrrMinor: mrr ? Math.round(mrr.amountMinor) : 0,
    mrrCurrency: mrr?.currency ?? sales.salesCurrency,
  };
}
