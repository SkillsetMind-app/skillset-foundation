"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

type OnboardingProgressProps = {
  activeQuestion: number;
  totalQuestions?: number;
};

export function OnboardingProgress({
  activeQuestion,
  totalQuestions = 7,
}: OnboardingProgressProps) {
  const { t } = useTranslation();
  const label = t("authFlow.onboarding.progress")
    .replace("{current}", String(activeQuestion))
    .replace("{total}", String(totalQuestions));
  // aria-label num <div> sem papel nao e lido; como barra de progresso o
  // leitor de tela anuncia "pergunta 3 de 8" (mesmo padrao do signup-form).
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={totalQuestions}
      aria-valuenow={activeQuestion}
      aria-valuetext={label}
      className="flex items-center gap-2"
    >
      {Array.from({ length: totalQuestions }, (_, index) => {
        const questionNumber = index + 1;
        const isActive = questionNumber === activeQuestion;
        const isPast = questionNumber < activeQuestion;

        return (
          <span
            key={questionNumber}
            className={[
              "h-2 rounded-full transition-all duration-[var(--duration-base)]",
              isActive
                ? "w-6 bg-[var(--color-accent)]"
                : isPast
                  ? "w-2 bg-[var(--color-primary)] opacity-50"
                  : "w-2 bg-[var(--color-line-strong)]",
            ].join(" ")}
          />
        );
      })}
    </div>
  );
}
