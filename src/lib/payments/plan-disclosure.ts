import { PLAN_TRIAL_DAYS, type Plan, type PlanBillingCycle } from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";

type Translate = (key: string) => string;

// A "cancel before {date}" deadline has to hold in every time zone. At any
// instant, UTC−12 is on the earliest calendar date on Earth, so the date
// printed here is never later than the real one wherever the reader is.
const DEADLINE_TIME_ZONE = "Etc/GMT+12";
const DAY_MS = 24 * 60 * 60 * 1000;

/** When a trial started now would end. Stripe counts from checkout completion, which is later. */
export function planTrialEnd(now: Date): Date {
  return new Date(now.getTime() + PLAN_TRIAL_DAYS * DAY_MS);
}

export function formatTrialDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: DEADLINE_TIME_ZONE,
  }).format(date);
}

/**
 * "$5/month", "$50/year", "$89 al mes"... Always "$" (en-US): the pricing page
 * and the help copy write prices that way in both languages.
 */
export function planPriceLabel(
  t: Translate,
  plan: Plan,
  cycle: PlanBillingCycle,
): string {
  const amount = formatUsdWhole(cycle === "yearly" ? plan.yearlyUsd : plan.monthlyUsd);
  return t(cycle === "yearly" ? "planTrial.pricePerYear" : "planTrial.pricePerMonth")
    .replace("{amount}", () => amount);
}

/**
 * The automatic-renewal disclosure (US ROSCA, 15 U.S.C. 8403) shown BEFORE the
 * card is collected: on the plan card next to its CTA, beside the embedded
 * checkout, and on the Stripe Checkout page as `custom_text.submit.message`.
 * One function, so all three say the same price, interval and date.
 */
export function planDisclosure({
  t,
  locale,
  plan,
  cycle,
  trial,
  publicOffer = false,
  now = new Date(),
}: {
  t: Translate;
  locale: string;
  plan: Plan;
  cycle: PlanBillingCycle;
  trial: boolean;
  publicOffer?: boolean;
  now?: Date;
}): string {
  const price = planPriceLabel(t, plan, cycle);
  if (!trial) {
    return t("planTrial.disclosureNoTrial").replace("{price}", () => price);
  }
  // Public pages can be cached; no subscription deadline exists there yet.
  return t(publicOffer ? "planTrial.disclosurePublic" : "planTrial.disclosure")
    .replace("{days}", String(PLAN_TRIAL_DAYS))
    .replace("{price}", () => price)
    .replace("{date}", () => formatTrialDate(planTrialEnd(now), locale));
}
