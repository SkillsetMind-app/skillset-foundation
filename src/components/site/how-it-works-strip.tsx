import { PenLine, Send, Sparkles, type LucideIcon } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

type Step = {
  number: string;
  title: string;
  description: string;
  Icon: LucideIcon;
};

// Server component: only translated text, no state. It stays out of the
// browser bundle; what needs the client here is RevealSection, which remains a
// client component and is mounted as a child.
export async function HowItWorksStrip() {
  const { t } = await getServerTranslation();

  const steps: ReadonlyArray<Step> = [
    {
      number: "01",
      title: t("home.how.step1Title"),
      description: t("home.how.step1Desc"),
      Icon: PenLine,
    },
    {
      number: "02",
      title: t("home.how.step2Title"),
      description: t("home.how.step2Desc"),
      Icon: Sparkles,
    },
    {
      number: "03",
      title: t("home.how.step3Title"),
      description: t("home.how.step3Desc"),
      Icon: Send,
    },
  ];

  return (
    <section className="home-how__panel mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      {/* Larger section title, from 36px on phones to 52px, always below the
          top title (clamp(2.3rem, 4.6vw, 3.6rem)) at any width.
          Wider (max-w-4xl) to stay on two lines: the pinned desktop
          panel has to fit below the bar. */}
      <RevealSection className="home-heading max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("home.how.kicker")}
        </p>
        <h2 className="display-title mt-3 text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]">
          {t("home.how.title")}
        </h2>
      </RevealSection>
      <div className="home-steps mt-10 grid gap-8 sm:mt-12 lg:grid-cols-3">
        {steps.map((step) => {
          const { Icon } = step;
          return (
            <RevealSection key={step.number} className="home-step">
              <article className="home-step__line border-t-2 border-[var(--color-primary)] pt-6">
                <div className="flex items-center gap-4">
                  <span
                    className="home-step__icon grid size-11 place-items-center rounded-md bg-[var(--color-primary)] text-[var(--color-base)] shadow-[var(--shadow-soft)]"
                    aria-hidden="true"
                  >
                    <Icon size={20} strokeWidth={1.7} />
                  </span>
                  <p
                    className="home-step__number display-title text-6xl leading-none text-[var(--color-ink-muted)]"
                    aria-hidden="true"
                  >
                    {step.number}
                  </p>
                </div>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {step.title}
                </h3>
                {/* Running text at 17px (18px from md) and in the full text color,
                    for readers who are 55+. From lg up the steps
                    become three narrow columns inside the pinned panel, which
                    has to fit below the bar at 1280x640 and 1024x720 (step 3
                    in Spanish is the longest): there 16px with a 24px line
                    takes the same height as the 14px/28px from before. */}
                <p className="mt-3 text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg lg:text-base lg:leading-6">
                  {step.description}
                </p>
              </article>
            </RevealSection>
          );
        })}
      </div>
    </section>
  );
}
