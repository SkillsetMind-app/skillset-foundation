type Translate = (key: string) => string;

export type CourseSubscriptionInterval = "month" | "year";

/**
 * The automatic-renewal notice for a subscription course (US ROSCA,
 * 15 U.S.C. 8403), stated BEFORE the card is asked for: on the purchase card, next to
 * the button, and on the Stripe page as `custom_text.submit.message`.
 * A single function, so both say the same price and the same interval.
 *
 * `amountMinor` is the list price in the house convention (value x 100 in every
 * currency): it is what each renewal charges. A coupon only applies to the first invoice,
 * which is why the sentence says "Charged today, then {price}" instead of repeating the amount.
 */
export function courseSubscriptionDisclosure({
  t,
  locale,
  amountMinor,
  currency,
  interval,
}: {
  t: Translate;
  locale: string;
  amountMinor: number;
  currency: string;
  interval: CourseSubscriptionInterval;
}): string {
  const price = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);
  return t(
    interval === "year"
      ? "publicCourses.subscriptionDisclosureYearly"
      : "publicCourses.subscriptionDisclosureMonthly",
  ).replace("{price}", () => price);
}
