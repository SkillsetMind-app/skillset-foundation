"use client";

import { LoginForm } from "@/components/auth/login-form";
import { SignupForm } from "@/components/auth/signup-form";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { ArrowLeft, Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// Reassurance points shown on the desktop brand panel. Decorative (the panel is
// aria-hidden) — the same promises live across the marketing site; here they
// just give the navy column substance beside the form.
const ASIDE_PROOF: ReadonlyArray<readonly [string, string]> = [
  [
    "Reviewed marketplace",
    "Every program is vetted by Skillset before it goes live.",
  ],
  [
    "Paid in 30+ currencies",
    "Global checkout via Stripe, payouts direct to your bank.",
  ],
  [
    "Verifiable certificates",
    "Each completion gets a public verification URL.",
  ],
];

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
    <main className="auth-split">
      {/* Brand panel — desktop only, decorative (form carries all functional UI). */}
      <aside className="auth-aside" aria-hidden="true">
        {/* Brand photo behind the copy — the same navy portrait as the homepage
            hero, with a scrim so the white brand text stays legible. */}
        <Image
          src="/brand/hero/hero-woman-6.png"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 48vw, 0px"
          // ponytail: x% keeps her face in the panel crop; nudge if off-centre.
          className="pointer-events-none object-cover [object-position:66%_center]"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(160deg, rgba(7,9,13,0.32), rgba(7,9,13,0.82))",
          }}
        />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
          Skillset for experts
        </p>
        <div className="relative">
          <h2 className="display-title text-[clamp(2rem,3vw,2.9rem)] leading-[1.1] text-white">
            Teach the world what you know.
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-7 text-white/75">
            Publish a reviewed program, reach students in 30+ currencies, and
            get paid directly — without building a website or stitching tools
            together.
          </p>
        </div>
        <ul className="relative space-y-4">
          {ASIDE_PROOF.map(([title, detail]) => (
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
      </div>
    </main>
  );
}
