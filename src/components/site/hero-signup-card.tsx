"use client";

import { ArrowRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { getPrimaryWorkspaceHref } from "@/lib/auth/routing";

// Hotmart-style conversion card for the hero's right column. Guests get the
// "create your account, free" widget; a signed-in visitor gets a direct path
// to their workspace so the prime real estate is never a dead end.
//
// The email field is a conversion primer only — it carries to the real /auth
// signup form as a query param (no auth logic lives here). Google / full
// signup happen on /auth, so nothing here fakes an OAuth flow.
export function HeroSignupCard() {
  const { status, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");

  if (status === "authenticated" && user) {
    return (
      <div className="hero-signup-card" aria-label="Your account">
        <p className="hero-signup-card__eyebrow">Welcome back</p>
        <h2 className="hero-signup-card__title">Pick up where you left off.</h2>
        <p className="hero-signup-card__sub">
          Your courses, students, and payouts are one click away.
        </p>
        <Link
          href={getPrimaryWorkspaceHref(user)}
          className="button-solid-light mt-5 w-full px-4 py-3 text-sm"
        >
          <LayoutDashboard aria-hidden="true" size={16} strokeWidth={1.9} />
          Go to your dashboard
        </Link>
        <Link
          href="/courses"
          className="hero-signup-card__ghost mt-2 w-full px-4 py-3 text-sm"
        >
          Browse courses
        </Link>
      </div>
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    const query = new URLSearchParams({ mode: "signup", path: "teacher" });
    if (trimmed) {
      query.set("email", trimmed);
    }
    router.push(`/auth?${query.toString()}`);
  }

  return (
    <div className="hero-signup-card">
      <p className="hero-signup-card__eyebrow">Get started</p>
      <h2 className="hero-signup-card__title">
        Create your account. It&rsquo;s free.
      </h2>
      <p className="hero-signup-card__sub">
        Publish your first course in days. No card required to start.
      </p>

      <form className="mt-5 grid gap-3" onSubmit={handleSubmit}>
        <label className="hero-signup-card__label grid gap-1.5 text-left text-[13px] font-semibold">
          Work email
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="hero-signup-card__input rounded-[10px] px-4 py-3 text-sm font-normal outline-none"
          />
        </label>

        <button
          type="submit"
          className="button-solid-light group w-full px-4 py-3 text-sm"
        >
          Create account
          <ArrowRight
            aria-hidden="true"
            size={16}
            strokeWidth={2}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </button>
      </form>

      <div className="hero-signup-card__divider">
        <span>or</span>
      </div>

      <Link
        href="/auth?mode=signup"
        className="hero-signup-card__ghost w-full px-4 py-3 text-sm"
      >
        Continue with Google
      </Link>

      <p className="hero-signup-card__foot">
        Already have an account?{" "}
        <Link href="/auth?mode=signin" className="hero-signup-card__link">
          Sign in
        </Link>
      </p>

      <p className="hero-signup-card__terms">
        By continuing you agree to our{" "}
        <Link href="/legal/terms" className="hero-signup-card__link">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="hero-signup-card__link">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
