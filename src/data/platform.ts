/**
 * Money formatter shared by marketing and account pages. Plan economics
 * (commission rates, monthly prices, break-even points) live in
 * `src/data/plans.ts` — import from there.
 */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Whole-dollar USD (no cents) for plan pricing, where every amount is a round
 * dollar figure. Keeps "$19" / "$190" / "$1,990" visually even instead of the
 * default "$19.00" the currency formatter produces — the uneven, decimal-heavy
 * look the pricing cards had before.
 */
export function formatUsdWhole(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
