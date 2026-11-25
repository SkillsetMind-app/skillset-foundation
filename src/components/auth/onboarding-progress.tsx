"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ProgressBar } from "@/components/ui/progress-bar";

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
  // They used to be hand-made dots (brass background, navy at 50%, animated width
  // with transition-all): now the house bar, the same as the classroom and the
  // builder. The screen reader still announces "question 3 of 8" (step from
  // 1 to the total, as in signup-form), and not a percentage.
  return (
    <ProgressBar
      value={(activeQuestion / totalQuestions) * 100}
      step={{ current: activeQuestion, total: totalQuestions }}
      label={label}
      className="w-32"
    />
  );
}
