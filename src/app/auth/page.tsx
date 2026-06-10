import { AuthPage } from "@/components/auth/auth-page";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Sign in or create an account | Skillset",
  robots: {
    index: false,
    follow: false,
  },
};

export default function UnifiedAuthPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthPage />
    </Suspense>
  );
}

// SSR fallback that mirrors the auth-card shape so the page never shows
// a bare "Preparing account access..." line. The real form replaces this
// the moment client JS hydrates and reads ?mode= from search params.
function AuthFallback() {
  return (
    <main className="auth-page">
      <section className="auth-main">
        <div className="auth-card" aria-busy="true" aria-live="polite">
          <div className="auth-tabs" role="presentation">
            <button type="button" className="active" disabled>
              Create account
            </button>
            <button type="button" disabled>
              Sign in
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
          <span className="sr-only">Loading sign-in form</span>
        </div>
      </section>
    </main>
  );
}
