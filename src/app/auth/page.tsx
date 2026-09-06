import { AuthPage } from "@/components/auth/auth-page";
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

// SSR fallback that mirrors the auth-card shape so the page never shows
// a bare "Preparing account access..." line. The real form replaces this
// the moment client JS hydrates and reads ?mode= from search params.
function AuthFallback({ t }: { t: (key: string) => string }) {
  return (
    <main className="auth-page">
      <section className="auth-main">
        <div className="auth-card" aria-busy="true" aria-live="polite">
          <div className="auth-tabs" role="presentation">
            <button type="button" className="active" disabled>
              {t("auth.page.tabCreate")}
            </button>
            <button type="button" disabled>
              {t("auth.page.tabSignIn")}
            </button>
          </div>
          <div className="space-y-3">
            <div className="mx-auto h-3 w-24 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="mx-auto h-8 w-3/4 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="mx-auto h-3 w-2/3 animate-pulse rounded bg-[var(--color-surface-soft)]" />
          </div>
          <div className="mt-6 space-y-3">
            <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
            <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
            <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-strong)]" />
          </div>
          <span className="sr-only">{t("authFlow.loadingForm")}</span>
        </div>
      </section>
    </main>
  );
}
