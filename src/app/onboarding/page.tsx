import Link from "next/link";

import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

type OnboardingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// ?path=teacher e a ativacao do ensino (menu "Become a teacher", convites,
// muro da area de ensino). O titulo dizia "Set up your SkillsetMind profile."
// em cima de uma tela que nao monta perfil nenhum. Aba e titulo usam a mesma
// chave.
async function titleKeyFor(searchParams: OnboardingPageProps["searchParams"]) {
  return (await searchParams)?.path === "teacher"
    ? "onboarding.streamlinedTitle"
    : "auth.onboardingShell.title";
}

export async function generateMetadata({ searchParams }: OnboardingPageProps = {}) {
  return privatePageMetadata(await titleKeyFor(searchParams));
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps = {}) {
  const { t } = await getServerTranslation();
  const titleKey = await titleKeyFor(searchParams);

  return (
    <AuthShell
      title={t(titleKey)}
      // Na ativacao, a frase sob o titulo vem da propria tela: so ela sabe se
      // o e-mail ainda falta.
      description={
        titleKey === "auth.onboardingShell.title"
          ? t("auth.onboardingShell.description")
          : undefined
      }
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
          <SkillsetSpinner fullscreen={false} title={t("authFlow.loading.title")} />
        }
      >
        <OnboardingChoice />
      </Suspense>
    </AuthShell>
  );
}
