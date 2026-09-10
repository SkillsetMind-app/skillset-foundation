import { getServerTranslation } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingWizard } from "@/components/auth/onboarding-wizard";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: t("learnWave2.onboarding.metadataTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function WelcomePage() {
  const { t } = await getServerTranslation();
  return (
    <Suspense
      fallback={
        <SkillsetSpinner
          title={t("learnWave2.onboarding.title")}
          description={t("learnWave2.onboarding.description")}
        />
      }
    >
      <OnboardingWizard />
    </Suspense>
  );
}
