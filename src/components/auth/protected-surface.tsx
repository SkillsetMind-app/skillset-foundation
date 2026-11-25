"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isFramedPlatformRoute, opensInPlatformShell } from "@/components/platform/platform-routes";
import { PlatformShellSkeleton } from "@/components/shared/page-skeletons";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { getAuthRoute } from "@/lib/auth/routing";
import { hasAnyPermission, type Permission } from "@/lib/permissions";
import { useSidebarState } from "@/lib/ui/sidebar-state";

type ProtectedSurfaceProps = {
  permissions: readonly Permission[];
  /** Signed out, offer /contact instead of account creation (the /support wall). */
  contactWhenSignedOut?: boolean;
  children: ReactNode;
};

export function ProtectedSurface({ permissions, contactWhenSignedOut = false, children }: ProtectedSurfaceProps) {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";

  if (status === "loading") {
    // This wait only shows on a full page load (refresh, new tab,
    // email link) and is what the server sends: coming from /loading or
    // /welcome the session already resolved before the route change (the AuthProvider
    // lives in the root layout and survives it), and the page opens directly. So,
    // on the platform screens, the wait has the shape of the shell that comes, and
    // not the ring: the page is the best bridge to the page. Everywhere else, the ring.
    // The sentence is the same as always, for the screen reader.
    const label = t("authFlow.loading.title");
    const shell = shellWaitFor(pathname);
    return shell ? <ShellWait label={label} framed={shell.framed} /> : <SkillsetSpinner title={label} />;
  }

  if (status === "mfa_required" || !user) {
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

    if (status === "mfa_required") {
      // The password passed, the code did not: aal1 session of an account with a second factor.
      // Never content. The login screen resumes the challenge on mount and returns
      // here through returnTo — without this branch the TOTP was decorative (A-17).
      return (
        <AccessPanel
          eyebrow={t("auth.guard.signInEyebrow")}
          title={t("auth.mfaTitle")}
          description={t("auth.mfaSubtitle")}
          cta={{ href: loginHref, label: t("auth.verify") }}
        />
      );
    }

    return (
      <AccessPanel
        eyebrow={t("auth.guard.signInEyebrow")}
        title={t("auth.guard.signInTitle")}
        description={t("auth.guard.signInDescription")}
        cta={{ href: loginHref, label: t("auth.guard.signIn") }}
        secondary={contactWhenSignedOut
          ? { href: "/contact", label: t("auth.guard.contactSupport") }
          : { href: getAuthRoute("signup", null, destination), label: t("auth.guard.createAccount") }}
      />
    );
  }

  if (!hasAnyPermission({ roles: user.roles }, permissions)) {
    // Blocked in the teaching area = a teacher who skipped the activation. Without
    // ?path=teacher, /onboarding opened the old 3-step signup, with
    // "learn" checked, in place of the one-step activation they skipped.
    const teacherArea =
      permissions.some((permission) => permission.startsWith("teacherStudio."))
      || pathname === "/teach"
      || pathname.startsWith("/teach/");
    return (
      <AccessPanel
        eyebrow={t("auth.guard.limitedEyebrow")}
        title={t("auth.guard.limitedTitle")}
        description={t("auth.guard.limitedDescription")}
        cta={{
          href: teacherArea ? "/onboarding?path=teacher" : "/onboarding",
          label: t("auth.guard.updateOnboarding"),
        }}
        secondary={{ href: "/contact", label: t("auth.guard.contactSupport") }}
      />
    );
  }

  return children;
}

// Which wait to show, by address only (never by the person's data): the rules
// live in platform-routes.ts, the same ones PlatformShell reads. A route outside the
// list gets the ring.
function shellWaitFor(pathname: string) {
  return opensInPlatformShell(pathname) ? { framed: isFramedPlatformRoute(pathname) } : null;
}

// The collapsed bar is read the way PlatformShell reads it: the cookie the layout read
// on the server holds in the HTML and in hydration (no window while rendering), so
// the column width does not change when the real shell comes in.
function ShellWait({ label, framed }: { label: string; framed: boolean }) {
  const { isCollapsed, isAuto } = useSidebarState();
  return <PlatformShellSkeleton label={label} collapsed={isCollapsed} auto={isAuto} framed={framed} />;
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
  const { t } = useTranslation();

  // The same frame and the same title size as the entry screens (logo,
  // language, back to home). Before, it was a loose card, with no logo, with a
  // 48px title that shouted.
  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {eyebrow}
      </p>
      <h1 className="auth-title display-title">{title}</h1>
      <p className="auth-description">{description}</p>
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
    </AuthFrame>
  );
}
