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
      eyebrow={t("auth.onboardingShell.eyebrow")}
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
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("auth.onboardingShell.kicker")}
        </p>
        <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
          {t("auth.onboardingShell.heading")}
        </h2>
        <Suspense
          fallback={
            <SkillsetSpinner
              fullscreen={false}
              title="Preparing onboarding"
              description="One moment. Skillset is getting things ready."
            />
          }
        >
          <OnboardingChoice />
        </Suspense>
      </div>
    </AuthShell>
  );
}
