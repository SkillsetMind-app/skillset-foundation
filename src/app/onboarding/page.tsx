import Link from "next/link";

import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function OnboardingPage() {
  const { t } = await getServerTranslation();

  return (
    <AuthShell
      title={t("auth.onboardingShell.title")}
      description={t("auth.onboardingShell.description")}
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
            title="Preparing onboarding"
            description="One moment. SkillsetMind is getting things ready."
          />
        }
      >
        <OnboardingChoice />
      </Suspense>
    </AuthShell>
  );
}
