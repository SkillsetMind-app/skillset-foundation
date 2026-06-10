import Link from "next/link";

import { HelpCenter } from "@/components/help/help-center";
import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// FAQ items grouped by category. The `id` on each item is the deep-link
// target used by in-app components (teacher-wallet → #payouts, course-builder
// → #course-pricing / #drip-release / #course-review, integrations page →
// #integrations). Keep the id whenever the FAQ moves between categories.
const categories: ReadonlyArray<{
  id: string;
  label: string;
  items: ReadonlyArray<{ id?: string; q: string; a: string }>;
}> = [
  {
    id: "getting-started",
    label: "Getting started",
    items: [
      {
        q: "How do students access a course?",
        a: "After enrollment is confirmed, the course appears in the student learning portal under Classroom. Progress, lessons, and any community spaces tied to the course are reachable from there.",
      },
      {
        q: "How do I create my Skillset account?",
        a: "Click Get started free on the homepage. You can sign up as a learner or jump straight to the teacher application from the For creators page. The same account works for learning and teaching.",
      },
    ],
  },
  {
    id: "course-creation",
    label: "Course creation",
    items: [
      {
        q: "Can creators upload courses themselves?",
        a: "Yes. Creators draft courses inside the Studio, attach lessons and media, and publish to the marketplace on submit. Skillset review runs afterward and never blocks your launch.",
      },
      {
        id: "course-pricing",
        q: "How do I set pricing for my course?",
        a: "Pricing is set per course inside Studio → course builder. You choose a one-time price in the currency of your choice; Stripe handles multi-currency checkout at the learner's end. The platform commission (8% on Free, 4% on Starter, 1% on Pro, 0% on Plus) plus the Stripe processing fee are shown clearly in the wallet ledger for every sale.",
      },
      {
        id: "drip-release",
        q: "What is drip release and when should I use it?",
        a: "Drip release lets you make lessons available on a schedule instead of all at once after enrollment. Useful for cohort-style programs or to pace learners across weeks. Configure per lesson in the course builder.",
      },
      {
        id: "course-review",
        q: "How does Skillset review work?",
        a: "Every course goes through a Skillset review, but review never blocks your launch — courses go on sale as soon as you submit. Reviewers check that lessons are complete, descriptions are accurate, pricing is reasonable, and any claims in the copy can be backed up. Typical review takes a few business days.",
      },
    ],
  },
  {
    id: "plans",
    label: "Plans & commission",
    items: [
      {
        q: "Which plan should I start on?",
        a: "Start on Free if you're validating an idea — there's no subscription and you keep 92% of every $100 sale before Stripe fees. Move to Starter ($19/mo, 4% commission) once you cross about $475/mo in sales. Pro and Plus pay back as you scale further. The pricing page lays out the break-even point for each plan.",
      },
      {
        q: "What happens when I upgrade or downgrade?",
        a: "Upgrades take effect immediately — the new commission applies to new sales right away (Stripe Billing prorates the subscription automatically). Downgrades take effect at the end of your current billing cycle. Sales made under your old plan keep that plan's commission rate; the rate is snapshotted at the moment of sale.",
      },
      {
        q: "What if I cancel my plan?",
        a: "Cancellation downgrades you to Free at the end of your paid period. Your courses, students, content, and history are preserved — Skillset never deletes a creator's data. Commission goes back to 8% (the Free rate) on new sales from the moment of downgrade.",
      },
    ],
  },
  {
    id: "payouts",
    label: "Payouts",
    items: [
      {
        id: "payouts",
        q: "When do I receive my first payout?",
        a: "Creator earnings move from pending to available 30 days after each sale — well past the 7-day refund window, so cleared payouts never need to be clawed back. From there, transfers settle to your connected Stripe account on Stripe's standard payout schedule. The wallet panel in Studio shows the exact clearance date for every line item.",
      },
      {
        q: "How are creator payouts handled?",
        a: "Earnings are tracked in a payout ledger inside Studio. After the hold period, the balance is released to your connected bank account through Stripe Connect. You can review every sale, fee deduction, and payout line in the ledger.",
      },
    ],
  },
  {
    id: "refunds",
    label: "Refunds",
    items: [
      {
        q: "How are refunds handled?",
        a: "Learners can request a refund within 7 days of purchase if they have completed less than half the course and have not received a certificate. The request is made directly from the order and processes automatically. Refunds appear in the creator wallet within minutes of being processed.",
      },
    ],
  },
  {
    id: "live",
    label: "Live classes",
    items: [
      {
        q: "Does Skillset support live classes?",
        a: "Today's model supports external live links (Zoom, Google Meet, etc.) and recording upload workflows. Lessons can include a live session link plus a follow-up recording so learners who missed the live stay on track. Native live streaming is on the roadmap.",
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    items: [
      {
        id: "integrations",
        q: "What integrations does Skillset support today?",
        a: "Skillset connects natively with Stripe for checkout, multi-currency payments, and creator payouts. Sign-in, media hosting, and file storage are built into the platform — nothing to set up. Need an integration you don't see yet? Contact support and we'll tell you where it sits on the roadmap.",
      },
    ],
  },
];

export const metadata = buildPageMetadata({
  title: "Help center",
  description:
    "Answers about courses, payments, payouts, refunds, integrations, and getting started on Skillset.",
  path: "/help",
});

export default function HelpPage() {
  return (
    <PublicPage
      eyebrow="Help"
      title="Help center."
      description="Short answers to the questions learners and creators ask most. Don't see your question? Contact support — a real person reads every message."
    >
      <HelpCenter categories={categories} />

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
          className="button-solid mt-6 inline-flex px-5 py-3 text-sm"
        >
          Contact support
        </Link>
      </div>
    </PublicPage>
  );
}
