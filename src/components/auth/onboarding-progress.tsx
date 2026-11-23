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
  // Eram pontinhos feitos à mão (latão de fundo, navy a 50%, largura animada
  // com transition-all): agora a barra da casa, a mesma da sala e do
  // construtor. O leitor de tela segue anunciando "pergunta 3 de 8" (passo de
  // 1 ao total, como no signup-form), e não uma porcentagem.
  return (
    <ProgressBar
      value={(activeQuestion / totalQuestions) * 100}
      step={{ current: activeQuestion, total: totalQuestions }}
      label={label}
      className="w-32"
    />
  );
}
