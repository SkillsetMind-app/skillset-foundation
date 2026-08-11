export const defaultSkillsetCurrency = "USD";

export const topSkillsetCurrencies = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "BRL",
  "MXN",
  "NGN",
  "ZAR",
  "GYD",
] as const;

export const supportedStripeCurrencies = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "BRL",
  "MXN",
  "NGN",
  "ZAR",
  "GYD",
  "ARS",
  "BBD",
  "BMD",
  "CLP",
  "COP",
  "CRC",
  "DOP",
  "GHS",
  "GTQ",
  "HKD",
  "INR",
  "JMD",
  "JPY",
  "KES",
  "NZD",
  "PEN",
  "SGD",
  "TTD",
  "UYU",
  "XCD",
] as const;

const supportedCurrencySet = new Set<string>(supportedStripeCurrencies);

export function isSupportedStripeCurrency(currency: string): boolean {
  return supportedCurrencySet.has(currency.toUpperCase());
}

export function normalizeSkillsetCurrency(currency?: string | null): string {
  const normalizedCurrency = currency?.trim().toUpperCase() || defaultSkillsetCurrency;

  return isSupportedStripeCurrency(normalizedCurrency)
    ? normalizedCurrency
    : defaultSkillsetCurrency;
}

// Stripe's "smallest currency unit" is NOT always 1/100. For a zero-decimal
// currency, a charge of ¥1,000 is sent as 1000 — not 100000. Two of our 30 are
// zero-decimal (CLP, JPY); none are three-decimal.
//
// We store every amount as value x 100 regardless of currency, because all 31
// display sites divide by 100 and Intl.NumberFormat renders JPY with zero
// fraction digits — so the stored 100000 already prints "¥1,000" correctly
// everywhere. Converting here, at the boundary, keeps that single internal
// convention and touches nothing downstream. Sending the raw stored value
// instead would charge the buyer 100x.
const zeroDecimalCurrencies = new Set<string>(["CLP", "JPY"]);

export function toStripeAmount(amountMinor: number, currency: string): number {
  if (!zeroDecimalCurrencies.has(currency.toUpperCase())) return amountMinor;
  // ponytail: rounds a fractional unit up (100050 -> 1001). A currency with no
  // sub-unit cannot express the half, and rounding toward the buyer's favour
  // would let a teacher shave a unit off every sale.
  const converted = Math.round(amountMinor / 100);
  // A positive price below half a unit (¥0.49 -> 0) would otherwise leave for
  // Stripe as a zero-amount charge, which it rejects — a paid course that can
  // never be bought. Floor at the smallest unit that exists.
  return amountMinor > 0 ? Math.max(1, converted) : converted;
}

// The same boundary in reverse: an amount READ BACK from Stripe (invoice
// totals, refunded totals) is in Stripe's unit, and everything downstream —
// the ledger, the refund cap, every display site — assumes ours.
export function fromStripeAmount(
  stripeAmount: number,
  currency: string,
): number {
  return zeroDecimalCurrencies.has(currency.toUpperCase())
    ? stripeAmount * 100
    : stripeAmount;
}

export function getCurrencyLabel(currency: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}
