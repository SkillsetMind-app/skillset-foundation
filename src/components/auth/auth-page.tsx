"use client";

import { LoginForm } from "@/components/auth/login-form";
import { SignupForm } from "@/components/auth/signup-form";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type AuthMode = "signup" | "signin";

function getMode(value: string | null): AuthMode {
  return value === "signin" ? "signin" : "signup";
}

export function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = getMode(searchParams.get("mode"));
  const isSignup = mode === "signup";

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("mode", nextMode);
    router.replace(`/auth?${nextParams.toString()}`, { scroll: false });
  }

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <LogoWordmark nav />
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
        >
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.8} />
          Back to home
        </Link>
      </div>
      <section className="auth-main">
        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={isSignup}
              className={isSignup ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isSignup}
              className={!isSignup ? "active" : ""}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
          </div>

          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {isSignup ? "Join Skillset" : "Welcome back"}
          </p>
          <h1 className="display-title mt-2 text-center text-[26px] leading-[1.15] text-[var(--color-primary)]">
            {isSignup ? "Create your account." : "Sign in to Skillset."}
          </h1>
          <p className="mx-auto mt-1.5 max-w-xs text-center text-[13px] leading-5 text-[var(--color-ink-soft)]">
            {isSignup
              ? "Free to start. Browse programs, save progress, and open creator tools from the same account."
              : "Pick up where you left off."}
          </p>

          {isSignup ? <SignupForm /> : <LoginForm />}
        </div>
      </section>
    </main>
  );
}
