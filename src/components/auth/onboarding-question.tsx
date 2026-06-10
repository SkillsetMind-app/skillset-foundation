"use client";

import type { ReactNode } from "react";

type OnboardingQuestionProps = {
  number: number;
  title: string;
  lead?: string;
  children: ReactNode;
};

export function OnboardingQuestion({
  children,
  lead,
  number,
  title,
}: OnboardingQuestionProps) {
  return (
    <section className="welcome-question mx-auto w-full max-w-[560px] text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Question {String(number).padStart(2, "0")}
      </p>
      <h1 className="display-title mt-4 text-4xl font-semibold leading-[1.15] text-[var(--color-primary)]">
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
