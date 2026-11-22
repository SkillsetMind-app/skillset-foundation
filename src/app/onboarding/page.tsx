import Link from "next/link";

import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function OnboardingPage({
  searchParams,
}: { searchParams?: Promise<{ path?: string | string[] }> } = {}) {
  const { t } = await getServerTranslation();
  // Quem chega como professor (fim da entrevista, "Become a teacher", aviso dos
  // termos) ve a ativacao curta: o titulo "Set up your profile / Choose your
  // path..." nao batia com uma tela que so pede os termos.
  const teacherActivation = (await searchParams)?.path === "teacher";

  return (
    <AuthShell
      title={t(teacherActivation ? "onboarding.streamlinedTitle" : "auth.onboardingShell.title")}
      description={t(teacherActivation ? "onboarding.streamlinedDesc" : "auth.onboardingShell.description")}
      footer={
        <>
          {t("auth.onboardingShell.footerPrompt")}{" "}
          <Link href="/courses" className="font-semibold text-[var(--color-primary)]">
            {t("auth.onboardingShell.footerLink")}
          </Link>
        </>
      }
    >
      <Suspense
        fallback={
          <SkillsetSpinner
            fullscreen={false}
            title={t("learnWave2.onboarding.title")}
            description={t("learnWave2.onboarding.description")}
          />
        }
      >
        <OnboardingChoice />
      </Suspense>
    </AuthShell>
  );
}
