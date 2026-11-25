// Money on screen, one currency at a time. Born in the Earnings panel (#580) and
// lives here so that Home, Reports and Earnings write amounts the same way.

type MoneyOptions = Pick<
  Intl.NumberFormatOptions,
  "minimumFractionDigits" | "maximumFractionDigits" | "notation"
>;

/**
 * A value in ONE currency, in the requested language. A code that Intl refuses
 * ("UNSPECIFIED" from old rows without a currency, or empty) falls back to
 * "CODE 12.34": a RangeError here would take down the whole page.
 */
export function formatMoney(
  amountMinor: number,
  currency: string | null | undefined,
  locale: string,
  options: MoneyOptions = {},
): string {
  try {
    return new Intl.NumberFormat(locale, {
      ...options,
      style: "currency",
      currency: currency ?? "",
    }).format(amountMinor / 100);
  } catch {
    return `${currency ?? ""} ${(amountMinor / 100).toFixed(2)}`.trim();
  }
}

/**
 * Several currencies side by side, each in its own amount ("R$100.00 · $20.00"),
 * in the order received: nothing converts, nothing adds up different currencies. With no
 * amount at all: zero in the only known currency, or a plain "0" (without inventing a currency).
 */
export function formatMoneyBreakdown(
  values: ReadonlyArray<{ currency: string; amountMinor: number }>,
  locale: string,
  zeroCurrency: string | null,
  options: MoneyOptions = {},
): string {
  if (!values.length) {
    return zeroCurrency ? formatMoney(0, zeroCurrency, locale, options) : "0";
  }
  return values
    .map((value) => formatMoney(value.amountMinor, value.currency, locale, options))
    .join(" · ");
}
