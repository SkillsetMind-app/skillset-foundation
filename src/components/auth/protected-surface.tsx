"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { hasAnyPermission, type Permission } from "@/lib/permissions";

type ProtectedSurfaceProps = {
  permissions: readonly Permission[];
  children: ReactNode;
};

export function ProtectedSurface({ permissions, children }: ProtectedSurfaceProps) {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";

  if (status === "loading") {
    return (
      <SkillsetSpinner
        title={t("auth.guard.loadingTitle")}
        description={t("auth.guard.loadingDescription")}
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
        eyebrow={t("auth.guard.signInEyebrow")}
        title={t("auth.guard.signInTitle")}
        description={t("auth.guard.signInDescription")}
        cta={{ href: loginHref, label: t("auth.guard.signIn") }}
        secondary={{ href: "/signup", label: t("auth.guard.createAccount") }}
      />
    );
  }

  if (!hasAnyPermission({ roles: user.roles }, permissions)) {
    return (
      <AccessPanel
        eyebrow={t("auth.guard.limitedEyebrow")}
        title={t("auth.guard.limitedTitle")}
        description={t("auth.guard.limitedDescription")}
        cta={{ href: "/onboarding", label: t("auth.guard.updateOnboarding") }}
        secondary={{ href: "/contact", label: t("auth.guard.contactSupport") }}
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
