import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { planById, payoutClearDays } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const creatorTools = [
  "Course builder with modules, lessons, previews, pricing, and drip release.",
  "Protected student workspace with progress, files, and certificates.",
  "Course-linked community, events, and future notifications.",
  "Stripe Connect onboarding, refund controls, and payout ledger.",
  "Skillset review of every course, without blocking your launch.",
  "Shareable course links for simple launch campaigns.",
];

const freePlan = planById("free");

export const metadata = buildPageMetadata({
  title: "Teach on Skillset",
  description: `Publish professional courses to a global audience. Start free at ${freePlan.commissionPercent}% commission, payouts ${payoutClearDays} days after each sale, course community and certificates included on every plan.`,
  path: "/for-creators",
});

export default function ForCreatorsPage() {
  return (
    <PublicPage
      eyebrow="For creators"
      title="Teach with a real course operating system."
      description="Skillset is designed for experts who want to publish structured learning products, manage students, build community, and get paid without stitching together disconnected tools."
    >
      <section className="mt-8 rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-3 gap-5 sm:flex sm:gap-8">
            <div>
              <p className="display-title text-3xl text-[var(--color-primary)]">
                {freePlan.commissionPercent}%
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                Commission on Free
              </p>
            </div>
            <div>
              <p className="display-title text-3xl text-[var(--color-primary)]">
                $0
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                To start
              </p>
            </div>
            <div>
              <p className="display-title text-3xl text-[var(--color-primary)]">
                {payoutClearDays} days
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                Until payout
              </p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
              Start free. Upgrade to drop commission to 4%, 1%, or 0%.
            </p>
            <Link
              href="/pricing"
              className="mt-2 inline-flex text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
            >
              See all four plans
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-3">
          {creatorTools.map((tool) => (
            <div
              key={tool}
              className="rounded-[14px] border fine-rule bg-white p-5 text-sm font-semibold leading-7 text-[var(--color-ink)] shadow-[var(--shadow-soft)]"
            >
              {tool}
            </div>
          ))}
        </div>
        <aside className="primary-fill-card rounded-[18px] border border-[var(--color-line)] bg-[var(--color-primary)] p-6 text-white shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
            Creator path
          </p>
          <h2 className="display-title mt-3 text-4xl">
            Start as a creator, publish after review.
          </h2>
          <p className="mt-4 text-sm leading-7 text-white/78">
            Creators can draft courses immediately. Marketplace visibility
            remains controlled by Skillset review so the platform does not turn
            into a noisy upload directory.
          </p>
          <Link href="/auth?mode=signup&path=teacher" className="button-solid-light mt-6 px-4 py-2.5 text-sm">
            Create account
          </Link>
        </aside>
      </section>
    </PublicPage>
  );
}
