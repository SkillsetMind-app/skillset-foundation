import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { plans, refundWindowDays } from "@/data/plans";

const policies = [
  [
    "You get paid directly",
    "Learners pay your Stripe account, not ours. SkillsetMind never holds your money, never remits it to you, and never sits between you and your buyer. You are the merchant of record on every sale.",
  ],
  [
    "Platform fee",
    `Plan-based: ${plans
      .map((plan) => `${plan.name} ${plan.commissionPercent}%`)
      .join(" · ")}. Every plan includes the same features — the difference is the commission SkillsetMind takes per paid sale, deducted by Stripe at the moment of the charge. Start free, upgrade when the math helps you.`,
  ],
  [
    "Stripe processing fee",
    "Charged by Stripe to your account on every sale. US Stripe pricing is 2.9% + $0.30 for USD card payments and an estimated 5.4% + $0.30 for non-USD; your own rates are the ones Stripe sets in the country your account is registered in. Never hidden inside the platform percentage.",
  ],
  [
    "Refund window",
    `Self-serve for ${refundWindowDays} days from purchase, subject to course progress and certificate status. A refund is debited from your Stripe balance, and our commission on that sale is returned with it — you never pay a fee on a sale that was undone.`,
  ],
  [
    "Payout schedule",
    "There is no platform clearance period, because there is nothing for us to clear. The sale lands in your own Stripe balance, and Stripe pays it to your bank on your connected account's payout schedule. The account is yours — but because it is a Stripe Express account opened through SkillsetMind, the payout interval is a platform setting rather than one you pick, and in some countries (Brazil included) the interval cannot be changed at all. Stripe applies its usual verification delay before a brand-new account's first payout, and settlement timing depends on your country and payment method. Marketplaces that collect your sales into their own account have to clear that money before they release it; we never collect it, so there is nothing to release.",
  ],
  [
    "Payout account",
    "Creators connect Stripe before selling any paid course. Checkout stays closed until your account can accept charges.",
  ],
  [
    "Currency",
    "Marketplace shows USD by default. Stripe Checkout presents local payment methods and currency where supported.",
  ],
  [
    "Taxes",
    "Stripe Tax can be enabled per market when international volume justifies activation. Creators see the breakdown per sale in their earnings ledger — our record of the charge, our commission, and the Stripe fee as we compute it, not a balance we hold. Your Stripe dashboard remains the authority on the exact fee and on settlement.",
  ],
  [
    "Disputes and chargebacks",
    "As merchant of record, you carry the chargeback. Stripe freezes and, if the dispute is lost, debits the amount from your balance — we record the outcome but cannot reverse it for you. Auto-suspension never triggers below 1.5% chargebacks over a rolling 90-day window (see the Promise).",
  ],
];

export default function FeesAndPayoutsPage() {
  return (
    <PublicPage
      eyebrow="Fees and payouts"
      title="Your buyers pay you. Directly."
      description="SkillsetMind is not a middleman for your money. Learners charge your Stripe account, Stripe deducts our commission at the moment of the sale, and the rest is already yours — no platform balance, no platform holding period, no waiting for us to remit."
    >
      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {policies.map(([title, detail]) => (
          <article
            key={title}
            className="rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {title}
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {detail}
            </p>
          </article>
        ))}
      </section>

      <div className="mt-10 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-6">
        <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
          Full plan comparison, sample breakdowns, and break-even points are on
          the{" "}
          <Link
            href="/pricing"
            className="font-semibold text-[var(--color-primary)] underline underline-offset-2"
          >
            pricing page
          </Link>
          .
        </p>
      </div>
    </PublicPage>
  );
}
