"use client";

import { PenLine, Send, Sparkles, type LucideIcon } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { RevealSection } from "@/components/shared/reveal-section";

type Step = {
  number: string;
  title: string;
  description: string;
  Icon: LucideIcon;
};

export function HowItWorksStrip() {
  const { t } = useTranslation();

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
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("home.how.kicker")}
        </p>
        <h2 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
          {t("home.how.title")}
        </h2>
      </RevealSection>
      <div className="mt-10 grid gap-8 sm:mt-12 lg:grid-cols-3">
        {steps.map((step) => {
          const { Icon } = step;
          return (
            <RevealSection key={step.number}>
              <article className="border-t-2 border-[var(--color-primary)] pt-6">
                <div className="flex items-center gap-4">
                  <span
                    className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-primary)] text-[var(--color-base)] shadow-[var(--shadow-soft)]"
                    aria-hidden="true"
                  >
                    <Icon size={20} strokeWidth={1.7} />
                  </span>
                  <p
                    className="display-title text-6xl leading-none text-[var(--color-ink-muted)]"
                    aria-hidden="true"
                  >
                    {step.number}
                  </p>
                </div>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
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
