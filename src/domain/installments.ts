/**
 * Installment plan helpers for one-time course sales (Hotmart-style display +
 * Stripe card installments when the currency/account supports them).
 *
 * PIX/boleto are not required for this path — card installments only.
 */

export type InstallmentPlanInput = {
  amountMinor: number;
  installmentsEnabled: boolean;
  installmentsMax: number | null | undefined;
  currency: string;
  stripeAccountCountry?: string | null;
};

export type InstallmentPlan = {
  enabled: boolean;
  maxCount: number;
  /** Equal-split display rows (no interest) for buyer-facing UI. */
  options: { count: number; amountMinor: number; label: string }[];
  /** Stripe Mexico account + MXN eligibility; card eligibility remains Stripe-owned. */
  stripeCardInstallmentsEligible: boolean;
};

export function normalizeInstallmentsMax(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.min(24, Math.max(1, n));
}

/** Sale in MXN on a Mexican Stripe account: the only place where card installments work. */
export function isStripeCardInstallmentsEligible(
  currency: string,
  stripeAccountCountry?: string | null,
): boolean {
  return (
    String(currency || "").toUpperCase() === "MXN"
    && String(stripeAccountCountry || "").toUpperCase() === "MX"
  );
}

/**
 * The same rule as the checkout (/api/payments/checkout): the flag
 * payments.cardInstallments turned on and the sale eligible. The builder only offers
 * "let people pay in installments" when this is true; otherwise the option does not
 * exist on the screen, instead of showing up disabled with a technical explanation.
 */
export function canSplitPayments(input: {
  featureEnabled: boolean;
  currency: string;
  stripeAccountCountry?: string | null;
}): boolean {
  return (
    input.featureEnabled
    && isStripeCardInstallmentsEligible(input.currency, input.stripeAccountCountry)
  );
}

export function buildInstallmentPlan(input: InstallmentPlanInput): InstallmentPlan {
  const currency = String(input.currency || "USD").toUpperCase();
  const stripeCardInstallmentsEligible = isStripeCardInstallmentsEligible(
    currency,
    input.stripeAccountCountry,
  );
  const maxCount = normalizeInstallmentsMax(input.installmentsMax ?? 1);
  const enabled =
    Boolean(input.installmentsEnabled) &&
    maxCount >= 2 &&
    Number.isFinite(input.amountMinor) &&
    input.amountMinor > 0;

  if (!enabled) {
    return {
      enabled: false,
      maxCount: 1,
      options: [],
      stripeCardInstallmentsEligible,
    };
  }

  const options: InstallmentPlan["options"] = [];
  for (let count = 2; count <= maxCount; count += 1) {
    const per = Math.floor(input.amountMinor / count);
    options.push({
      count,
      amountMinor: per,
      label: `${count}x of ${formatMinor(per, currency)}`,
    });
  }

  return {
    enabled: true,
    maxCount,
    options,
    stripeCardInstallmentsEligible,
  };
}

function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}
