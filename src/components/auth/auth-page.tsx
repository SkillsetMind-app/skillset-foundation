"use client";

import { LoginForm } from "@/components/auth/login-form";
import { SignupForm } from "@/components/auth/signup-form";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { getAuthPathIntentFromSearchParams } from "@/lib/auth/routing";
import { ArrowLeft, Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

type AuthMode = "signup" | "signin";

function getMode(value: string | null): AuthMode {
  return value === "signin" ? "signin" : "signup";
}

export function AuthPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const mode = getMode(searchParams.get("mode"));
  const isSignup = mode === "signup";
  // The brand panel mirrors the form's path intent: teacher CTAs land on the
  // expert pitch, everything else (default) speaks to learners. Same flow —
  // one account, role picked at onboarding — only the pitch changes.
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  const asideKey =
    pathIntent === "teacher" ? "auth.page.aside.teacher" : "auth.page.aside.learner";
  const asideProof: ReadonlyArray<readonly [string, string]> = [
    [t(`${asideKey}.point1Title`), t(`${asideKey}.point1Desc`)],
    [t(`${asideKey}.point2Title`), t(`${asideKey}.point2Desc`)],
    [t(`${asideKey}.point3Title`), t(`${asideKey}.point3Desc`)],
  ];

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("mode", nextMode);
    router.replace(`/auth?${nextParams.toString()}`, { scroll: false });
  }

  return (
    <main className="auth-split">
      {/* Brand panel — desktop only, decorative (form carries all functional UI). */}
      <aside className="auth-aside" aria-hidden="true">
        {/* Portrait crop (1300x1272 from the 3000px master) so the tall panel
            downscales instead of blowing up a low-res landscape frame. */}
        <Image
          src="/brand/hero/auth-portrait.jpg"
          alt=""
          fill
          priority
          // Cover is height-driven in this tall panel, so the served width must
          // track viewport height, not the 44% column width.
          sizes="(min-width: 1024px) 60vw, 0px"
          // ponytail: x% keeps her face in the panel crop; nudge if off-centre.
          className="pointer-events-none object-cover [object-position:40%_center]"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(160deg, rgba(7,9,13,0.32), rgba(7,9,13,0.82))",
          }}
        />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
          {t(`${asideKey}.eyebrow`)}
        </p>
        <div className="relative">
          <h2 className="display-title text-[clamp(2rem,3vw,2.9rem)] leading-[1.1] text-white">
            {t(`${asideKey}.title`)}
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-7 text-white/75">
            {t(`${asideKey}.description`)}
          </p>
        </div>
        <ul className="relative space-y-4">
          {asideProof.map(([title, detail]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/12 text-white">
                <Check size={13} strokeWidth={2.6} />
              </span>
              <span>
                <span className="block text-sm font-bold text-white">
                  {title}
                </span>
                <span className="block text-[13px] leading-5 text-white/65">
                  {detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Form column */}
      <div className="auth-form-col">
        <div className="auth-topbar">
          <LogoWordmark nav />
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
          >
            <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.8} />
            {t("auth.page.backToHome")}
          </Link>
        </div>
        <section className="auth-main">
          <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label={t("auth.page.modeAria")}>
            <button
              type="button"
              role="tab"
              aria-selected={isSignup}
              className={isSignup ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              {t("auth.page.tabCreate")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isSignup}
              className={!isSignup ? "active" : ""}
              onClick={() => switchMode("signin")}
            >
              {t("auth.page.tabSignIn")}
            </button>
          </div>

          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {isSignup ? t("auth.page.kickerSignup") : t("auth.page.kickerSignin")}
          </p>
          <h1 className="display-title mt-2 text-center text-[26px] leading-[1.15] text-[var(--color-primary)]">
            {isSignup ? t("auth.page.titleSignup") : t("auth.page.titleSignin")}
          </h1>
          <p className="mx-auto mt-1.5 max-w-xs text-center text-[13px] leading-5 text-[var(--color-ink-soft)]">
            {isSignup ? t("auth.page.subSignup") : t("auth.page.subSignin")}
          </p>

          {isSignup ? <SignupForm /> : <LoginForm />}
          </div>
        </section>
      </div>
    </main>
  );
}
