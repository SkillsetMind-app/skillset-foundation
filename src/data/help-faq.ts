/**
 * Help center FAQ — single source of truth.
 *
 * Rendered by /help AND fed verbatim to the platform assistant
 * (src/lib/assistant/knowledge.ts) as its grounding context, so the bot can
 * never drift from what the help page publicly states. Edit answers here and
 * both surfaces update together.
 *
 * The `id` on each item is the deep-link target used by in-app components
 * (teacher-wallet → #payouts, course-builder → #course-pricing /
 * #drip-release / #course-review, integrations page → #integrations). Keep
 * the id whenever the FAQ moves between categories.
 */

export type HelpFaqItem = { id?: string; q: string; a: string };

export type HelpFaqCategory = {
  id: string;
  label: string;
  items: ReadonlyArray<HelpFaqItem>;
};

export const helpFaqCategories: ReadonlyArray<HelpFaqCategory> = [
  {
    id: "getting-started",
    label: "Getting started",
    items: [
      {
        q: "How do students access a course?",
        a: "After enrollment is confirmed, the course appears in the student learning portal under Classroom. Progress, lessons, and any community spaces tied to the course are reachable from there.",
      },
      {
        q: "How do I create my SkillsetMind account?",
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
        a: "Yes. Creators can draft and build products before professional verification is complete. Once their professional credential is approved and the product checks pass, they publish directly and public links, catalog visibility, and sales open immediately.",
      },
      {
        id: "course-categories",
        q: "How should I choose course categories?",
        a: "Choose the most specific category that matches the professional outcome first; it becomes the product's primary marketplace category. Add only genuinely relevant secondary categories so learners can discover the course without weakening its positioning.",
      },
      {
        id: "course-pricing",
        q: "How do I set pricing for my course?",
        a: "Pricing is set per product inside Studio → course builder. Choose free enrollment, a one-time price, or a monthly or yearly subscription in a supported currency. The platform commission (10% on Free, 5% on Starter, 3% on Pro, 2% on Plus) plus the Stripe processing fee are shown clearly in the wallet ledger for every sale.",
      },
      {
        id: "drip-release",
        q: "What is drip release and when should I use it?",
        a: "Drip release lets you make lessons available on a schedule instead of all at once after enrollment. Useful for cohort-style programs or to pace learners across weeks. Configure per lesson in the course builder.",
      },
      {
        id: "course-publishing",
        q: "How does publishing work?",
        a: "SkillsetMind verifies the professional rather than manually approving every course. Approved creators publish directly after the builder checks the course structure, price, payout setup, and public preview reference. Automated compliance checks may flag exceptional cases after publication without silently taking a product down.",
      },
    ],
  },
  {
    id: "plans",
    label: "Plans & commission",
    items: [
      {
        q: "Which plan should I start on?",
        a: "Start on Free if you're validating an idea — there's no subscription and you keep 90% of every $100 sale before Stripe fees. Move to Starter ($19/mo, 5% commission) once you cross about $380/mo in sales. Pro and Plus pay back as you scale further. The pricing page lays out the break-even point for each plan.",
      },
      {
        q: "What happens when I upgrade or downgrade?",
        a: "Upgrades take effect immediately — the new commission applies to new sales right away (Stripe Billing prorates the subscription automatically). Downgrades take effect at the end of your current billing cycle. Sales made under your old plan keep that plan's commission rate; the rate is snapshotted at the moment of sale.",
      },
      {
        q: "What if I cancel my plan?",
        a: "Cancellation downgrades you to Free at the end of your paid period. Your courses, students, content, and history are preserved — SkillsetMind never deletes a creator's data. Commission goes back to 10% (the Free rate) on new sales from the moment of downgrade.",
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
        a: "Your buyers pay your own Stripe account directly — you are the merchant of record, and SkillsetMind never holds or remits your money. There is no platform clearing period: Stripe pays out from your balance to your bank on your account's own payout schedule, which you set in Stripe. Complete Stripe's identity verification and your first payout follows that schedule.",
      },
      {
        q: "How are creator payouts handled?",
        a: "Stripe pays you from your own connected account; SkillsetMind is never in the middle. Every sale, our platform fee, and every refund is recorded in the earnings ledger inside Studio so you can reconcile it against your Stripe dashboard. Refunds and lost disputes are debited from your Stripe balance — and when a sale is refunded, our platform fee comes back to you with it.",
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
        q: "Does SkillsetMind support live classes?",
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
        q: "What integrations does SkillsetMind support today?",
        a: "SkillsetMind connects natively with Stripe for checkout, multi-currency payments, and creator payouts. Sign-in, media hosting, and file storage are built into the platform — nothing to set up. Need an integration you don't see yet? Contact support and we'll tell you where it sits on the roadmap.",
      },
    ],
  },
];
