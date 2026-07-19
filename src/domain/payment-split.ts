/**
 * Marketplace payment split — canonical money math.
 *
 * Business rule (see DECISIONS.md D1/D2): the teacher absorbs the Stripe
 * processing fee so the platform keeps its full commission. The charge model
 * is `separate_charges_and_transfers`, so there is NO Stripe
 * `application_fee_amount` (that is a destination-charge concept) — the fee is
 * reflected by reducing the teacher transfer (`teacherNetMinor`).
 *
 * All amounts are integer minor units (cents). Money is never a float.
 *
 * This module is the SOURCE OF TRUTH. `functions/src/index.ts` mirrors
 * `stripeProcessingFeeMinor` and the ledger split for the webhook runtime
 * (separate Firebase Functions package) and must be kept in sync with this.
 */

/**
 * Default platform commission, in basis points. Matches the Free plan
 * (10%) — any creator without an active subscription is treated as Free.
 * Callers WITH a plan attached must pass the plan's commission rate
 * explicitly via the `platformFeeBps` argument.
 */
export const DEFAULT_PLATFORM_FEE_BPS = 1000;

/** Stripe standard pricing, USD cards: 2.9%. */
const USD_PERCENT_BPS = 290;
/** Stripe non-USD estimate: international card 4.4% + conversion 1%. */
const INTERNATIONAL_PERCENT_BPS = 540;
/** Fixed per-successful-charge component (~$0.30). */
const FIXED_FEE_MINOR = 30;

/**
 * Estimated Stripe processing fee for a successful charge, in minor units.
 * USD is treated as domestic (2.9% + $0.30); any other currency uses the
 * international card plus conversion estimate (5.4% + $0.30). The estimate is
 * applied at ledger time; the exact fee settles on the platform balance.
 */
export function stripeProcessingFeeMinor(
  grossMinor: number,
  currency: string,
): number {
  const isUsd = currency.toUpperCase() === "USD";
  const percentBps = isUsd ? USD_PERCENT_BPS : INTERNATIONAL_PERCENT_BPS;
  return Math.round((grossMinor * percentBps) / 10000) + FIXED_FEE_MINOR;
}

export interface PaymentSplit {
  /** What the learner paid. */
  grossMinor: number;
  /** Platform commission (kept in full). */
  platformCommissionMinor: number;
  /** Stripe fee, passed through to the teacher. */
  stripeFeeMinor: number;
  /** What the teacher receives after the hold window. */
  teacherNetMinor: number;
}

/**
 * Splits a gross order amount into platform commission, Stripe fee (passed to
 * the teacher), and the teacher net transfer. Never returns a negative net.
 */
export function computePaymentSplit(
  grossMinor: number,
  currency: string,
  platformFeeBps: number = DEFAULT_PLATFORM_FEE_BPS,
): PaymentSplit {
  const platformCommissionMinor = Math.floor(
    (grossMinor * platformFeeBps) / 10000,
  );
  const stripeFeeMinor = stripeProcessingFeeMinor(grossMinor, currency);
  const teacherNetMinor = Math.max(
    0,
    grossMinor - platformCommissionMinor - stripeFeeMinor,
  );

  return {
    grossMinor,
    platformCommissionMinor,
    stripeFeeMinor,
    teacherNetMinor,
  };
}
