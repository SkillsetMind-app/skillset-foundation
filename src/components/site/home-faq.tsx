import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

// The questions a 55+ coach asks before signing up, only the ones the
// help center already answers: [category of /help, position in it]. Question
// and answer are the same keys as /help (publicPages.helpFaq), without rewriting
// anything, and each answer ends with the link to its category on /help.
// Left out: "do I need to know technology?": the help center does not answer it.
const QUESTIONS = [
  ["plans", 0], // Which plan: price, commission and the 14-day free trial.
  ["payouts", 0], // The buyer pays the teacher directly, and when the money arrives.
  ["plans", 2], // Cancel, including during the trial, with no charge.
  ["refunds", 0], // Refund.
  ["course-creation", 0], // The teacher uploads the course themselves.
  ["integrations", 0], // Video and files hosted on the platform, nothing to configure.
] as const;

// Native <details>/<summary>: opens and closes by keyboard, without JavaScript. The
// arrow rotates on open; with reduced motion it changes position without moving.
export async function HomeFaq() {
  const { t } = await getServerTranslation();

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection className="home-heading max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("footer.helpCenter")}
        </p>
        <h2 className="display-title mt-3 text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]">
          {t("publicPages.pricing.common_questions")}
        </h2>
      </RevealSection>
      <div className="mt-10 grid max-w-4xl gap-3 sm:mt-12">
        {QUESTIONS.map(([category, index]) => {
          const key = `publicPages.helpFaq.${category}.items.${index}`;
          const questionId = `home-faq-${category}-${index}`;
          return (
            <details
              key={key}
              className="group rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)] [&_summary::-webkit-details-marker]:hidden"
            >
              {/* Question at 18px and a 56px touch target (55+ audience); the
                  focus ring is the global one for <summary>. */}
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-4 text-lg font-semibold leading-snug text-[var(--color-ink)]">
                <span id={questionId}>{t(`${key}.q`)}</span>
                <ChevronDown
                  aria-hidden="true"
                  size={22}
                  strokeWidth={2.2}
                  className="shrink-0 text-[var(--color-primary)] group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-[var(--duration-base)] motion-safe:ease-[var(--ease-standard)]"
                />
              </summary>
              <div className="px-5 pb-6">
                <p className="text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
                  {t(`${key}.a`)}
                </p>
                {/* The same text on all six links: the question is used as the
                    description, for the screen reader's list of links. */}
                <Link
                  href={`/help#${category}`}
                  aria-describedby={questionId}
                  className="mt-3 inline-flex min-h-12 items-center gap-2 text-base font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                >
                  {t("home.faq.more")}
                  <ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
                </Link>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
