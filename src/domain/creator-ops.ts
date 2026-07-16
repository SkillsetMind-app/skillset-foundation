/**
 * Creator operations rollup - sales + subscriptions + wallet signals.
 * Pure domain helpers for the Teacher Operations hub (P5).
 */
import type { CreatorSubscriptionMetrics } from "@/domain/creator-subscriptions";
import { isPaidOrder, type Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

export type CurrencyAmount = {
  currency: string;
  amountMinor: number;
};

export type CreatorWalletSummary = {
  salesCount: number;
  grossPaidByCurrency: CurrencyAmount[];
  platformFeeByCurrency: CurrencyAmount[];
  stripeFeeByCurrency: CurrencyAmount[];
  teacherNetByCurrency: CurrencyAmount[];
  walletInReleaseByCurrency: CurrencyAmount[];
  walletReleasedByCurrency: CurrencyAmount[];
  refundedByCurrency: CurrencyAmount[];
};

export type CreatorOpsSnapshot = {
  salesCount: number;
  salesGrossByCurrency: CurrencyAmount[];
  walletInReleaseByCurrency: CurrencyAmount[];
  walletReleasedByCurrency: CurrencyAmount[];
  activeSubscribers: number;
  pastDueSubscribers: number;
  mrrByCurrency: CurrencyAmount[];
  mrrSnapshotMissingCount: number;
  mrrLegacyFallbackCount: number;
};

export function summarizeCreatorSales(
  orders: Order[],
): Pick<CreatorOpsSnapshot, "salesCount" | "salesGrossByCurrency"> {
  const paid = orders.filter((order) => isPaidOrder(order.status));
  const grossByCurrency = new Map<string, number>();

  for (const order of paid) {
    addCurrencyAmount(grossByCurrency, order.currency, order.amountMinor);
  }

  return {
    salesCount: paid.length,
    salesGrossByCurrency: toCurrencyAmounts(grossByCurrency),
  };
}

export function summarizeCreatorWallet(
  ledgers: PayoutLedgerEntry[],
): CreatorWalletSummary {
  const grossPaid = new Map<string, number>();
  const platformFee = new Map<string, number>();
  const stripeFee = new Map<string, number>();
  const teacherNet = new Map<string, number>();
  const inRelease = new Map<string, number>();
  const released = new Map<string, number>();
  const refunded = new Map<string, number>();
  const earningEntries = ledgers.filter(
    (entry) =>
      entry.status !== "refunded" && entry.status !== "partially_refunded",
  );

  for (const entry of earningEntries) {
    addCurrencyAmount(grossPaid, entry.currency, entry.grossAmountMinor);
    addCurrencyAmount(platformFee, entry.currency, entry.skillsetFeeMinor);
    addCurrencyAmount(stripeFee, entry.currency, entry.stripeFeeMinor ?? 0);
    addCurrencyAmount(teacherNet, entry.currency, entry.netAmountMinor);

    if (entry.status === "in_release" || entry.status === "releasing") {
      addCurrencyAmount(inRelease, entry.currency, entry.netAmountMinor);
    } else if (
      entry.status === "released"
      || entry.status === "released_advance"
    ) {
      addCurrencyAmount(released, entry.currency, entry.netAmountMinor);
    }
  }

  for (const entry of ledgers) {
    if (entry.status !== "refunded" && entry.status !== "partially_refunded") {
      continue;
    }
    addCurrencyAmount(
      refunded,
      entry.currency,
      entry.refundedAmountMinor ?? entry.grossAmountMinor,
    );
  }

  return {
    salesCount: earningEntries.length,
    grossPaidByCurrency: toCurrencyAmounts(grossPaid),
    platformFeeByCurrency: toCurrencyAmounts(platformFee),
    stripeFeeByCurrency: toCurrencyAmounts(stripeFee),
    teacherNetByCurrency: toCurrencyAmounts(teacherNet),
    walletInReleaseByCurrency: toCurrencyAmounts(inRelease),
    walletReleasedByCurrency: toCurrencyAmounts(released),
    refundedByCurrency: toCurrencyAmounts(refunded),
  };
}

export function buildCreatorOpsSnapshot(input: {
  orders: Order[];
  ledgers: PayoutLedgerEntry[];
  subscriptionMetrics: CreatorSubscriptionMetrics;
}): CreatorOpsSnapshot {
  const sales = summarizeCreatorSales(input.orders);
  const wallet = summarizeCreatorWallet(input.ledgers);

  return {
    ...sales,
    walletInReleaseByCurrency: wallet.walletInReleaseByCurrency,
    walletReleasedByCurrency: wallet.walletReleasedByCurrency,
    activeSubscribers: input.subscriptionMetrics.activeCount,
    pastDueSubscribers: input.subscriptionMetrics.pastDueCount,
    mrrByCurrency: input.subscriptionMetrics.mrrByCurrency,
    mrrSnapshotMissingCount:
      input.subscriptionMetrics.mrrSnapshotMissingCount,
    mrrLegacyFallbackCount:
      input.subscriptionMetrics.mrrLegacyFallbackCount,
  };
}

function addCurrencyAmount(
  totals: Map<string, number>,
  currencyValue: unknown,
  amountValue: unknown,
): void {
  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount === 0) return;

  const currency = normalizeCurrency(currencyValue);
  totals.set(currency, (totals.get(currency) ?? 0) + amount);
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value ?? "").trim().toUpperCase();
  return currency || "UNSPECIFIED";
}

function toCurrencyAmounts(totals: Map<string, number>): CurrencyAmount[] {
  return Array.from(totals, ([currency, amountMinor]) => ({
    currency,
    amountMinor,
  })).sort((a, b) => a.currency.localeCompare(b.currency));
}
