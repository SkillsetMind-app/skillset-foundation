"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { hasAnyPermission, type Permission } from "@/lib/permissions";

type ProtectedSurfaceProps = {
  permissions: readonly Permission[];
  children: ReactNode;
};

export function ProtectedSurface({ permissions, children }: ProtectedSurfaceProps) {
  const { status, user } = useAuth();
  const pathname = usePathname() ?? "";

  if (status === "loading") {
    return (
      <SkillsetSpinner
        title="Preparing your workspace"
        description="Skillset is checking your account session before opening this area."
      />
    );
  }

  if (!user) {
    // Preserve the deep link (path + query) through the sign-in wall so a
    // shared course/workspace URL lands back where the visitor was headed
    // instead of dying on the role dashboard. login-form validates it.
    //
    // Query read straight from window.location instead of useSearchParams():
    // the hook forces a CSR bailout that breaks static prerender on every
    // page using this guard. This branch only ever renders client-side —
    // during SSR/prerender, auth status is "loading" and the spinner above
    // renders instead — so window is always available here.
    const queryString =
      typeof window === "undefined"
        ? ""
        : window.location.search.replace(/^\?/, "");
    const destination = `${pathname}${queryString ? `?${queryString}` : ""}`;
    const loginHref = pathname
      ? `/login?returnTo=${encodeURIComponent(destination)}`
      : "/login";

    return (
      <AccessPanel
        eyebrow="Sign in required"
        title="This area needs an account."
        description="Sign in or create an account to continue into the learning, teaching, or operations workspace."
        cta={{ href: loginHref, label: "Sign in" }}
        secondary={{ href: "/signup", label: "Create account" }}
      />
    );
  }

  if (!hasAnyPermission({ roles: user.roles }, permissions)) {
    return (
      <AccessPanel
        eyebrow="Access limited"
        title="Your account is not set up for this area."
        description="Choose the right onboarding path or contact support if you believe this account should have access."
        cta={{ href: "/onboarding", label: "Update onboarding" }}
        secondary={{ href: "/contact", label: "Contact support" }}
      />
    );
  }

  return children;
}

function AccessPanel({
  eyebrow,
  title,
  description,
  cta,
  secondary,
}: {
  eyebrow: string;
  title: string;
  description: string;
  cta?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <main className="page-shell min-h-screen">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-5 py-12 sm:px-8">
        <div className="w-full rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {eyebrow}
          </p>
          <h1 className="display-title mt-3 text-5xl leading-none text-[var(--color-primary)]">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {description}
          </p>
          {(cta || secondary) ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {cta ? (
                <Link href={cta.href} className="button-solid px-4 py-2.5 text-sm">
                  {cta.label}
                </Link>
              ) : null}
              {secondary ? (
                <Link href={secondary.href} className="button-outline px-4 py-2.5 text-sm">
                  {secondary.label}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
