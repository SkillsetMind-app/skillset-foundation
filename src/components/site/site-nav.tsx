"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { AccountMenu } from "@/components/site/account-menu";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { LayoutDashboard, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getPrimaryWorkspaceHref } from "@/lib/auth/routing";

// "Courses" leads: it is the door for people who come here to learn. The
// rest is the creator conversion path (creators, pricing, promise, help).
const navItems = [
  { href: "/courses", labelKey: "nav.courses" },
  { href: "/for-creators", labelKey: "nav.forCreators" },
  { href: "/pricing", labelKey: "nav.pricing" },
  { href: "/promise", labelKey: "nav.promise" },
  { href: "/help", labelKey: "nav.help" },
];

// On the single-page landing the header scrolls to in-page sections instead
// of navigating away. Other pages don't pass `landingNav` and keep the route
// links above (zero behavior change off the homepage).
type LandingNavItem =
  | { labelKey: string; anchorId: string }
  | { labelKey: string; href: string };

type SiteNavProps = {
  landingNav?: readonly LandingNavItem[];
};

type ResolvedNavItem = {
  key: string;
  label: string;
  target: string;
  isAnchor: boolean;
};

function resolveNavItems(
  t: (key: string) => string,
  landingNav?: readonly LandingNavItem[],
): ResolvedNavItem[] {
  if (landingNav) {
    return landingNav.map((item) =>
      "anchorId" in item
        ? {
            key: item.anchorId,
            label: t(item.labelKey),
            target: `#${item.anchorId}`,
            isAnchor: true,
          }
        : {
            key: item.href,
            label: t(item.labelKey),
            target: item.href,
            isAnchor: false,
          },
    );
  }

  return navItems.map((item) => ({
    key: item.href,
    label: t(item.labelKey),
    target: item.href,
    isAnchor: false,
  }));
}

function isActiveNav(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav({ landingNav }: SiteNavProps = {}) {
  const { status, user, signOut } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const resolvedNav = resolveNavItems(t, landingNav);
  const isAuthenticated = status === "authenticated" && user;

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 8);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    // Sync with an external system (the router): collapse the mobile menu
    // whenever the route changes. This is a deliberate, safe one-shot reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <div className="site-header__inner relative">
        <LogoWordmark nav />
        <nav
          aria-label={t("nav.primaryNavLabel")}
          className="site-header__links"
        >
          {resolvedNav.map((item) => {
            if (item.isAnchor) {
              return (
                <a
                  key={item.key}
                  href={item.target}
                  className="site-header__link"
                >
                  {item.label}
                </a>
              );
            }

            const active = isActiveNav(pathname, item.target);

            return (
              <Link
                key={item.key}
                href={item.target}
                aria-current={active ? "page" : undefined}
                className={`site-header__link ${active ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="site-header__actions">
          {/* Language sits next to the entry actions on every width; the
              footer keeps its own copy for people who scroll to the end. */}
          <LocaleSwitcher />
          {isAuthenticated ? (
            <>
              <Link
                href={getPrimaryWorkspaceHref(user)}
                className="btn-cta-hero hidden items-center gap-2 sm:inline-flex"
              >
                <LayoutDashboard aria-hidden="true" size={16} strokeWidth={1.9} />
                {t("nav.dashboard")}
              </Link>
              <AccountMenu user={user} onSignOut={signOut} />
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              {/* A plain link: the old learner/teacher menu only changed the
                  panel copy on the same sign-in screen, so it was a detour. */}
              <Link href="/auth?mode=signin" className="btn-signin">
                {t("nav.signIn")}
              </Link>
              <Link href="/auth?mode=signup" className="btn-cta-hero">
                {t("nav.getStarted")}
              </Link>
            </div>
          )}
          <button
            type="button"
            aria-label={mobileOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={mobileOpen}
            aria-controls="site-mobile-menu"
            onClick={() => setMobileOpen((open) => !open)}
            className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-[var(--color-line)] bg-white text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] lg:hidden"
          >
            {mobileOpen ? (
              <X aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <Menu aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </button>
        </div>

        {mobileOpen ? (
          <>
            <button
              type="button"
              aria-label={t("nav.closeMenu")}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-[44] bg-[rgba(15,39,68,0.4)] lg:hidden"
            />
            <div
              id="site-mobile-menu"
              className="absolute inset-x-0 top-[calc(100%+8px)] z-[46] rounded-[14px] border border-[var(--color-line)] bg-white p-3 shadow-[0_24px_48px_rgba(15,39,68,0.16)] lg:hidden"
            >
              <nav aria-label={t("nav.mobileNavLabel")} className="grid gap-1">
                {resolvedNav.map((item) => {
                  const baseClass =
                    "rounded-[10px] px-3 py-3 text-sm font-semibold transition-colors";

                  if (item.isAnchor) {
                    return (
                      <a
                        key={`mobile-${item.key}`}
                        href={item.target}
                        onClick={() => setMobileOpen(false)}
                        className={`${baseClass} text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]`}
                      >
                        {item.label}
                      </a>
                    );
                  }

                  const active = isActiveNav(pathname, item.target);

                  return (
                    <Link
                      key={`mobile-${item.key}`}
                      href={item.target}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`${baseClass} ${
                        active
                          ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                          : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              {isAuthenticated ? (
                <div className="mt-3 grid gap-2 border-t border-[var(--color-line)] pt-3">
                  <Link
                    href={getPrimaryWorkspaceHref(user)}
                    onClick={() => setMobileOpen(false)}
                    className="button-solid w-full px-4 py-2.5 text-sm"
                  >
                    {t("nav.goToDashboard")}
                  </Link>
                  <Link
                    href="/account"
                    onClick={() => setMobileOpen(false)}
                    className="button-outline w-full px-4 py-2.5 text-sm"
                  >
                    {t("nav.accountSettings")}
                  </Link>
                </div>
              ) : (
                <div className="mt-3 grid gap-2 border-t border-[var(--color-line)] pt-3">
                  <Link
                    href="/auth?mode=signin"
                    className="button-outline w-full px-4 py-2.5 text-sm"
                  >
                    {t("nav.signIn")}
                  </Link>
                  <Link
                    href="/auth?mode=signup"
                    className="button-solid w-full px-4 py-2.5 text-sm"
                  >
                    {t("nav.getStarted")}
                  </Link>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
