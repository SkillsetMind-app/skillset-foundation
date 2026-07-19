import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { plans, refundWindowDays, payoutClearDays } from "@/data/plans";

const policies = [
  [
    "Platform fee",
    `Plan-based: ${plans
      .map((plan) => `${plan.name} ${plan.commissionPercent}%`)
      .join(" · ")}. Every plan includes the same features — the difference is the commission SkillsetMind takes per paid sale. Start free, upgrade when the math helps you.`,
  ],
  [
    "Stripe processing fee",
    "Passed through to the creator on every sale: 2.9% + $0.30 for USD card payments, 5.4% + $0.30 estimated for non-USD. Never hidden inside the platform percentage.",
  ],
  [
    "Refund window",
    `Self-serve for ${refundWindowDays} days from purchase, subject to course progress and certificate status. Refunds inside the window restore the creator's commission automatically.`,
  ],
  [
    "Payout clearance",
    `Creator net is released ${payoutClearDays} days after each sale — the moment the ${refundWindowDays}-day refund window closes — and transfers to the connected Stripe account. Never a 30-day hold.`,
  ],
  [
    "Payout account",
    "Creators connect Stripe Connect before selling any paid course. Transfers settle to the connected bank account on Stripe's standard schedule.",
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
    "Commission is held until resolution. If the creator loses, the commission is deducted from the available balance. Auto-suspension never triggers below 1.5% chargebacks over a rolling 90-day window (see the Promise).",
  ],
];

export default function FeesAndPayoutsPage() {
  return (
    <PublicPage
      eyebrow="Fees and payouts"
      title="A payout policy built for trust."
      description="SkillsetMind separates the learner payment, refund window, platform fee, Stripe processing fee, and creator payout ledger so the marketplace can protect learners and creators without hiding the rules."
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
