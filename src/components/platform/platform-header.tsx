"use client";

import { usePathname } from "next/navigation";
import { ChevronRight, Menu } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { NotificationBell } from "@/components/platform/notification-bell";
import { AccountMenu } from "@/components/site/account-menu";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { platformNav } from "@/data/site";

export function PlatformHeader({
  onOpenMobileNav,
}: {
  onOpenMobileNav?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const { t } = useTranslation();
  const { status, user, signOut } = useAuth();
  const surface = getSurface(pathname);
  const pageLabel = getPageLabel(pathname, t);

  return (
    <header className="platform-topbar">
      <div className="platform-topbar__inner">
        <LogoWordmark nav href="/" className="platform-topbar__logo" />
        <nav
          aria-label={t("platform.breadcrumbLabel")}
          className="platform-crumbs"
        >
          <span>{t(`platform.crumbs.${surface}`)}</span>
          <ChevronRight
            aria-hidden="true"
            size={13}
            strokeWidth={1.8}
            className="text-[var(--color-ink-muted)]"
          />
          <span className="cur">{pageLabel}</span>
        </nav>

        <div className="platform-topbar__actions">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <div className="hidden sm:block">
            <NotificationBell />
          </div>
          {status === "authenticated" && user ? (
            <AccountMenu user={user} onSignOut={signOut} />
          ) : null}
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="grid size-10 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)] transition hover:bg-[var(--color-surface-strong)] sm:hidden"
            aria-label={t("platform.openMobileNav")}
          >
            <Menu aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}

type Surface = "learn" | "teach" | "ops" | "account" | "platform";

function getSurface(pathname: string): Surface {
  if (pathname.startsWith("/learn")) {
    return "learn";
  }

  if (pathname.startsWith("/teach")) {
    return "teach";
  }

  if (pathname.startsWith("/ops")) {
    return "ops";
  }

  if (pathname.startsWith("/account")) {
    return "account";
  }

  return "platform";
}

function getPageLabel(
  pathname: string,
  t: (key: string) => string,
): string {
  const matches = platformNav
    .filter(
      (item) =>
        pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length);

  if (matches[0]) {
    return t(matches[0].labelKey);
  }

  const segment = pathname.split("/").filter(Boolean).pop();

  if (!segment) {
    return t("platform.crumbs.home");
  }

  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
