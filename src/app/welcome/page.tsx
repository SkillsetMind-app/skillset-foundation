import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingWizard } from "@/components/auth/onboarding-wizard";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";

export const metadata: Metadata = {
  title: "Set up your account | SkillsetMind",
  robots: {
    index: false,
    follow: false,
  },
};

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <SkillsetSpinner
          title="Preparing onboarding"
          description="One moment. SkillsetMind is getting things ready."
        />
      }
    >
      <OnboardingWizard />
    </Suspense>
  );
}
