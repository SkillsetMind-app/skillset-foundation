"use client";

import { usePathname } from "next/navigation";
import { ArrowLeftRight, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { NotificationBell } from "@/components/platform/notification-bell";
import { PlatformSearch } from "@/components/platform/platform-search";
import { AccountMenu } from "@/components/site/account-menu";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AdvisorHeaderSlot } from "@/components/teacher/advisor-sidebar";
import { isPlatformNavItemHidden, platformNav } from "@/data/site";
import { getWorkspaceHomeHref, getWorkspaceSide } from "@/lib/auth/routing";
import { hasPermission, type PermissionSubject } from "@/lib/permissions";

// The hamburger here is gone: below 640px it opened EXACTLY the same
// drawer as the "More" on the bottom bar, which is always visible and within reach
// of the thumb. Two doors to the same room, one of them in the corner opposite the
// hand. From 640px up it was already `sm:hidden`, so nothing changes there.
export function PlatformHeader({ currentNavigationHref, searchHref }: {
  currentNavigationHref?: string;
  searchHref?: string | null;
}) {
  const pathname = usePathname() ?? "";
  const { t } = useTranslation();
  const { status, user, signOut } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  // Only the phone strip closes; on larger screens the field is fixed and
  // `searchOpen` is never turned on.
  const dismissSearch = (reason: "escape" | "submit") => {
    if (!searchOpen) return;
    setSearchOpen(false);
    if (reason === "escape") searchToggleRef.current?.focus();
  };
  const surface = getSurface(pathname);
  const pageLabel = getPageLabel(pathname, t, currentNavigationHref, { roles: user?.roles });
  const showSearch = searchHref !== null && (!pathname.startsWith("/ops") || Boolean(searchHref));
  const signedIn = status === "authenticated" && Boolean(user);
  const side = getWorkspaceSide(pathname, user);
  // Switching sides used to be "Switch view", hidden in the avatar menu, and the shortcut
  // to the public site opened a NEW TAB — for someone with little familiarity with the
  // internet, a new tab means "the site vanished". Now it is a visible button, in the same tab.
  const switchTo = signedIn && user && hasPermission({ roles: user.roles }, "teacherStudio.access")
    ? side === "teacher"
      ? { href: "/learn", label: t("platform.side.goStudent") }
      : { href: "/teach", label: t("platform.side.goTeacher") }
    : null;

  return (
    <header className="platform-topbar">
      <div className="platform-topbar__inner">
        <LogoWordmark
          nav
          variant="mark"
          href={getWorkspaceHomeHref(pathname, user)}
          className="platform-topbar__logo"
        />
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
        {/* On a phone the path above goes away (no room): what remains is the name of the side
            the person is on. */}
        {signedIn ? <p className="platform-topbar__side">{t(`platform.side.${side}`)}</p> : null}

        {showSearch ? <PlatformSearch pathname={pathname} open={searchOpen} searchHref={searchHref ?? undefined} onDismiss={dismissSearch} /> : null}

        <div className="platform-topbar__actions">
          {/* Below 1280px the button keeps only the icon (the text stays
              for screen readers): with the full text it pushed the language
              and the account menu off screen on a tablet and a small laptop.
              Help does not live here: it is one per screen, in the sidebar (on a
              phone, inside the drawer). */}
          {switchTo ? (
            <Link
              href={switchTo.href}
              aria-label={switchTo.label}
              title={switchTo.label}
              className="platform-topbar__switch"
            >
              <ArrowLeftRight aria-hidden="true" size={16} strokeWidth={1.9} />
              <span className="platform-topbar__switch-label">{switchTo.label}</span>
            </Link>
          ) : null}
          {/* On a phone the field does not fit in the row: the icon opens it right below
              the bar. On larger screens it is already open and this button goes away. */}
          {showSearch ? <button
            ref={searchToggleRef}
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            className="platform-topbar__search-toggle grid size-10 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)] transition hover:bg-[var(--color-surface-strong)]"
            aria-expanded={searchOpen}
            aria-label={t("platform.openSearch")}
          >
            <Search aria-hidden="true" size={18} strokeWidth={1.8} />
          </button> : null}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          {/* The bell was `hidden sm:block`, and it is the only place
              notifications exist — no mobile nav entry, no fallback. A teacher
              on a phone had no way to learn they made a sale. The trigger is
              size-10 like the hamburger and the panel is already
              w-[min(380px,100vw-32px)], so it was built for small screens and
              then hidden. ThemeToggle stays hidden: it is a preference, not a
              signal, and it is wider. */}
          <AdvisorHeaderSlot />
          <NotificationBell />
          {status === "authenticated" && user ? (
            <AccountMenu user={user} onSignOut={signOut} topBarSwitchHref={switchTo?.href} />
          ) : null}
          {/* The language only existed on the public site: inside /teach, /learn,
              /account and /ops the person had to leave the platform to switch.
              Last item of the cluster, at the far right — where the eye looks.
              All four surfaces go through this same header. */}
          <LocaleSwitcher variant="compact" />
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
  currentNavigationHref?: string,
  subject?: PermissionSubject,
): string {
  // A page with a learner name and a teacher name is two entries; skip the
  // one this account does not see.
  const items = platformNav.filter((item) => !isPlatformNavItemHidden(subject, item));
  const currentItem = items.find((item) => item.href === currentNavigationHref);
  if (currentItem) return t(currentItem.labelKey);

  const matches = items
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
