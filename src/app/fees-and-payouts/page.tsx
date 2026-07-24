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
    "Charged by Stripe to your account on every sale: 2.9% + $0.30 for USD card payments, 5.4% + $0.30 estimated for non-USD. Never hidden inside the platform percentage.",
  ],
  [
    "Refund window",
    `Self-serve for ${refundWindowDays} days from purchase, subject to course progress and certificate status. A refund is debited from your Stripe balance, and our commission on that sale is returned with it — you never pay a fee on a sale that was undone.`,
  ],
  [
    "Payout schedule",
    "There is no platform clearance period, because there is nothing for us to clear. Stripe pays out to your bank on your account's own payout schedule, which you control in your Stripe dashboard.",
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
    "Stripe Tax can be enabled per market when international volume justifies activation. Creators see the breakdown per sale in the wallet ledger.",
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
      description="SkillsetMind is not a middleman for your money. Learners charge your Stripe account, Stripe deducts our commission at the moment of the sale, and the rest is already yours — no platform balance, no holding period, no waiting for us to remit."
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
