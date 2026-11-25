import { PLAN_TRIAL_DAYS } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { supportedStripeCurrencies } from "@/lib/payments/currencies";

// Facts band right below the top, in place of the revenue, learner
// and country numbers that the competition shows. Only what is already true and already
// written on the site goes in: the 30 checkout currencies, the 24 months of Promise 01, its
// six commitments and the 14-day free trial. Nothing here talks about earnings. Promise
// 01 locks the commission and the per-sale fee, not the plan price: the
// caption says exactly that, so it does not look false on the day the plans
// change price. Where a number lives in the code (currencies, trial days) it
// comes from there, so the band does not drift away from the product. The trial caption starts
// in lowercase, because it continues the number: "14" + "day free trial, card
// required" reads as "14-day free trial". The numbers are static: the motion (fade in and rise 12px,
// one after the other) lives only in globals.css, behind the same guards as the
// home choreography, and outside them the band stays still and whole.
export async function HomeFactsBand() {
  const { t } = await getServerTranslation();
  const facts: ReadonlyArray<{ figure: string; label: string }> = [
    { figure: String(supportedStripeCurrencies.length), label: t("home.facts.currencies") },
    { figure: t("home.facts.feeLockMonths"), label: t("home.facts.feeLock") },
    { figure: t("home.facts.commitmentsCount"), label: t("home.facts.commitments") },
    { figure: String(PLAN_TRIAL_DAYS), label: t("home.facts.trial") },
  ];

  return (
    <section
      aria-labelledby="home-facts-title"
      className="home-facts border-b fine-rule bg-[var(--color-surface-soft)] py-12 sm:py-14 lg:py-16"
    >
      <h2 id="home-facts-title" className="sr-only">
        {t("home.facts.title")}
      </h2>
      {/* 2x2 on phones, 4 columns from lg. The number always stays below the
          top title (clamp(2.3rem, 4.6vw, 3.6rem)) at any width;
          the caption is running text: 17/18px in full color. The box is the same
          as the top's and the "How it works" (max-w-7xl with the padding INSIDE it):
          with the padding on the band, at 1440px the band started 32px to the left
          of the other sections. The background still runs edge to edge. */}
      <dl className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-x-6 gap-y-10 px-5 sm:px-8 lg:grid-cols-4 lg:gap-x-10">
        {facts.map((fact) => (
          <div key={fact.label} className="home-facts__item">
            <dt className="display-title text-[clamp(2.25rem,4.4vw,3.5rem)] leading-none text-[var(--color-primary)]">
              {fact.figure}
            </dt>
            <dd className="mt-4 text-[1.0625rem] leading-[1.5] text-[var(--color-ink)] before:mb-3 before:block before:h-0.5 before:w-10 before:bg-[var(--color-accent)] before:content-[''] md:text-lg">
              {fact.label}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
