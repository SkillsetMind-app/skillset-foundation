import Link from "next/link";

import { AssistantPanel } from "@/components/help/assistant-panel";
import { HelpCenter } from "@/components/help/help-center";
import { PublicPage } from "@/components/site/public-page";
import { helpFaqCategories } from "@/data/help-faq";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// FAQ content lives in src/data/help-faq.ts — shared with the platform
// assistant so the bot and this page can never disagree.

export const metadata = buildPageMetadata({
  title: "Help center",
  description:
    "Answers about courses, payments, payouts, refunds, integrations, and getting started on SkillsetMind.",
  path: "/help",
});

export default function HelpPage() {
  return (
    <PublicPage
      eyebrow="Help"
      title="Help center."
      description="Short answers to the questions learners and creators ask most. Don't see your question? Contact support — a real person reads every message."
    >
      <AssistantPanel />

      <HelpCenter categories={helpFaqCategories} />

      <div className="mt-12 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-7 text-center sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Still stuck?
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)] sm:text-4xl">
          Talk to a real person.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          Payment, payout, or course-review questions go to the human support
          queue. We answer in plain language, in business hours.
        </p>
        <Link
          href="/support"
          className="button-solid mt-6 inline-flex px-4 py-2.5 text-sm"
        >
          Contact support
        </Link>
      </div>
    </PublicPage>
  );
}
