import { helpFaqCategories } from "@/data/help-faq";
import { payoutClearDays, plans, refundWindowDays } from "@/data/plans";

// Grounding context for the platform assistant. Built from the SAME sources
// the site renders (help FAQ + plans.ts), so every fact the bot can state is
// a fact the platform already publishes — nothing hand-maintained that could
// drift. ponytail: the whole corpus is ~10KB, so we send it entire on every
// request instead of running retrieval; switch to search-then-stuff only if
// the corpus outgrows the model context.

// Real, shipped platform capabilities. Keep each line traceable to a live
// surface — this block is the only hand-written part of the corpus, so it is
// the only part a fact-check needs to re-verify against the codebase.
const PLATFORM_OVERVIEW = `Skillset is an online course marketplace where experts (psychologists, therapists, coaches, and other professionals) create and sell courses, and learners study them in a members area. One account can both learn and teach.
- Checkout and subscriptions run on Stripe; creators receive payouts through Stripe Connect after connecting their account in the Studio.
- Course video is hybrid: teachers can upload video files or embed from YouTube/Vimeo.
- Each course can enable an opt-in community space inside the members area.
- Teachers can schedule live sessions (external links such as Zoom/Meet); enrolled students see them in the course agenda and get an in-app notification.
- Students can message the course teacher from inside the course; teachers reply from Studio → Messages. There is no student-to-student messaging.
- Curated learning paths (ordered course sequences) can appear on the student learning dashboard with rolled-up progress.
- Skillset issues course certificates that can be verified online.
- The platform interface is available in English, Portuguese, and Spanish.
- Support: the /support page, or email support@skillsetmind.com. Legal terms live at /legal/terms, /legal/privacy, and /legal/teacher-terms.`;

function plansSection(): string {
  const rows = plans.map((plan) => {
    const price =
      plan.monthlyUsd === 0
        ? "no subscription"
        : `$${plan.monthlyUsd}/month or $${plan.yearlyUsd}/year`;
    return `- ${plan.name}: ${price}, ${plan.commissionPercent}% commission per paid sale. ${plan.tagline} For: ${plan.audience}`;
  });
  return [
    "Plans (every feature is available on every tier; plans only change the commission rate; the Stripe processing fee is passed through to the creator on every sale):",
    ...rows,
    `- Refund window: ${refundWindowDays} days from purchase (learner must have completed less than half the course and not received a certificate).`,
    `- Payout clearing: creator earnings stay pending for ${payoutClearDays} days after each sale before becoming available.`,
  ].join("\n");
}

function faqSection(): string {
  return helpFaqCategories
    .map((category) => {
      const items = category.items
        .map((item) => `Q: ${item.q}\nA: ${item.a}`)
        .join("\n\n");
      return `## ${category.label}\n\n${items}`;
    })
    .join("\n\n");
}

/** The full grounding context sent to the assistant on every request. */
export function buildAssistantKnowledge(): string {
  return [
    "# Skillset platform overview",
    PLATFORM_OVERVIEW,
    "# Plans, fees, refunds, payouts",
    plansSection(),
    "# Help center FAQ",
    faqSection(),
  ].join("\n\n");
}
