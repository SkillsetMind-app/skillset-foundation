import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: `${t("auth.forgot.title")} | SkillsetMind`,
    description: t("auth.forgot.description"),
    robots: { index: false, follow: false },
  };
}

export default async function ForgotPasswordPage() {
  const { t } = await getServerTranslation();

  return (
    <AuthShell
      eyebrow={t("auth.forgot.eyebrow")}
      title={t("auth.forgot.title")}
      description={t("auth.forgot.description")}
      footer={
        <>
          {t("auth.forgot.footerPrompt")}{" "}
          <Link href="/auth?mode=signin" className="font-semibold text-[var(--color-primary)]">
            {t("auth.forgot.footerLink")}
          </Link>
        </>
      }
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("auth.forgot.kicker")}
        </p>
        <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
          {t("auth.forgot.heading")}
        </h2>
        <ResetPasswordForm />
      </div>
    </AuthShell>
  );
}
