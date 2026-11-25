"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";

// The title receives focus when the question changes (onboarding-wizard.tsx).
export const ONBOARDING_QUESTION_TITLE_ID = "onboarding-question-title";

type OnboardingQuestionProps = {
  number: number;
  total: number;
  title: string;
  lead?: string;
  children: ReactNode;
};

export function OnboardingQuestion({
  children,
  lead,
  number,
  title,
  total,
}: OnboardingQuestionProps) {
  const { t } = useTranslation();
  return (
    <section className="welcome-question mx-auto w-full max-w-[560px] text-center">
      {/* "Question 3 of 8": the total only showed in the dots in the corner, and whoever
          sees poorly did not know how much was left. */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("authFlow.onboarding.progress")
          .replace("{current}", String(number))
          .replace("{total}", String(total))}
      </p>
      {/* tabIndex -1: focusable by code, outside the Tab order. The ring only
          shows through the global :focus-visible, not for mouse users. */}
      <h1
        id={ONBOARDING_QUESTION_TITLE_ID}
        tabIndex={-1}
        className="display-title mt-4 text-3xl font-semibold leading-[1.15] text-[var(--color-primary)] sm:text-4xl"
      >
        {title}
      </h1>
      {lead ? (
        <p className="mx-auto mt-3 max-w-[440px] text-sm leading-6 text-[var(--color-ink-soft)]">
          {lead}
        </p>
      ) : null}
      <div className="mt-8 text-left">{children}</div>
    </section>
  );
}
