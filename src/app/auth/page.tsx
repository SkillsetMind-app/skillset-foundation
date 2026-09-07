import { AuthPage } from "@/components/auth/auth-page";
import { AuthFrame } from "@/components/auth/auth-frame";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return { title: `${t("authFlow.pageTitle")} | SkillsetMind`, robots: { index: false, follow: false } };
}

export default async function UnifiedAuthPage() {
  const { t } = await getServerTranslation();
  return (
    <Suspense fallback={<AuthFallback t={t} />}>
      <AuthPage />
    </Suspense>
  );
}

// Keep the same frame while the client resolves the form's mode and intent.
function AuthFallback({ t }: { t: (key: string) => string }) {
  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <div aria-busy="true" aria-live="polite">
        <div className="space-y-3">
          <div className="h-8 w-3/4 animate-pulse rounded bg-[var(--color-surface-strong)]" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--color-surface-soft)]" />
        </div>
        <div className="mt-6 space-y-3">
          <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
          <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
          <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-strong)]" />
        </div>
        <span className="sr-only">{t("authFlow.loadingForm")}</span>
      </div>
    </AuthFrame>
  );
}
