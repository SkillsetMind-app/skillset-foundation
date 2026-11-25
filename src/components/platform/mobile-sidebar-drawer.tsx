"use client";

import {
  GraduationCap,
  Home,
  MoreHorizontal,
  Presentation,
  ShoppingBag,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";
import { SessionCard } from "@/components/platform/session-card";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import type { PlatformNavCounts } from "@/data/site";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { getWorkspaceHomeHref, getWorkspaceSide } from "@/lib/auth/routing";
import { hasPermission } from "@/lib/permissions";

type MobileSidebarDrawerProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  initialSection?: string;
  currentNavigationHref?: string;
  navigationCounts?: PlatformNavCounts;
};

// The list items, not the ☰ at the top of the bar: focus returns to a destination.
function visibleNavigationControl() {
  return Array.from(document.querySelectorAll<HTMLElement>(
    ".platform-sidebar .platform-sidebar-nav .platform-nav-link, .platform-mobile-nav button",
  )).find((element) => element.getClientRects().length > 0) ?? null;
}

export function MobileSidebarDrawer({
  open,
  onOpen,
  onClose,
  initialSection,
  currentNavigationHref,
  navigationCounts,
}: MobileSidebarDrawerProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const touchStartX = useRef<number | null>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useModalFocus(drawerRef, open, visibleNavigationControl);
  const homeHref = getWorkspaceHomeHref(pathname, user);
  // The shortcut is always the OTHER side: on the teacher side, "Learn"; on the
  // learner side, "Teach" (only for those who teach). It used to always be "Teach", and in the
  // studio it merged with Home — there was no way to go study from the bar.
  const side = getWorkspaceSide(pathname, user);
  const workspaceItem = useMemo(() => {
    const canTeach = Boolean(user) && hasPermission({ roles: user?.roles ?? [] }, "teacherStudio.access");

    return canTeach && side !== "teacher"
      ? { href: "/teach", label: t("platform.mobile.teach"), icon: Presentation }
      : { href: "/learn", label: t("platform.mobile.learn"), icon: GraduationCap };
  }, [user, side, t]);
  const primaryItems = [
    { href: homeHref, label: t("platform.mobile.home"), icon: Home },
    { href: "/courses", label: t("platform.mobile.market"), icon: ShoppingBag },
    workspaceItem,
    { href: "/account", label: t("platform.mobile.profile"), icon: User },
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.href === item.href) === index,
  );

  // Which tab is the current page. "Home" only applies at the start of the area: before, it
  // was marked on EVERY studio page (/teach/sales, /teach/reports...),
  // which are only reached through "More". The other tabs apply to the pages
  // inside them (/account/billing and Profile).
  const isCurrentTab = (href: string) =>
    href === homeHref ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const noTabIsCurrent = !primaryItems.some((item) => isCurrentTab(item.href));

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    // Below 1180px the collapsed rail opens this drawer; above, the group opens the
    // sidebar itself.
    const desktop = window.matchMedia?.("(min-width: 1180px)");
    function handleDesktopChange() {
      if (desktop?.matches) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    desktop?.addEventListener("change", handleDesktopChange);
    handleDesktopChange();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      desktop?.removeEventListener("change", handleDesktopChange);
    };
  }, [onClose, open]);

  return (
    <>
      <nav className="platform-mobile-nav" aria-label={t("platform.mobile.navLabel")}>
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isCurrentTab(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              // aria-current tells the screen reader which page it is; the current
              // tab's underline comes from the same marker (globals.css).
              aria-current={active ? "page" : undefined}
              className={[
                "grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2 text-[11px] font-bold text-[var(--color-ink-soft)]",
                active ? "text-[var(--color-primary)]" : "",
              ].join(" ")}
            >
              <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpen}
          // A page that only exists inside "More" (sales, reports...):
          // none of the tabs is it, so the marker stays on "More".
          data-current={noTabIsCurrent ? "true" : undefined}
          className="grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2 text-[11px] font-bold text-[var(--color-ink-soft)]"
          aria-label={t("platform.mobile.openMore")}
        >
          <MoreHorizontal aria-hidden="true" size={21} strokeWidth={1.8} />
          <span>{t("platform.mobile.more")}</span>
        </button>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-[100] min-[1180px]:hidden">
          {/* Backdrop and entrance of the other dialogs: the backdrop lights up and the drawer
              rises 8px (only without "reduce motion"). Before, it appeared in a hard
              cut, with its own navy. */}
          <button
            type="button"
            className="dialog-backdrop absolute inset-0"
            aria-label={t("platform.mobile.close")}
            onClick={onClose}
          />
          <aside
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t("platform.mobile.drawerLabel")}
            className="motion-panel-in relative z-[1] flex h-svh w-[280px] max-w-full flex-col bg-white shadow-[0_0_60px_rgba(15,39,68,0.25)] outline-none"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a[href]")) {
                onClose();
              }
            }}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current;
              const endX = event.changedTouches[0]?.clientX ?? null;

              if (startX !== null && endX !== null && startX - endX > 60) {
                onClose();
              }

              touchStartX.current = null;
            }}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] p-5">
              <div className="min-w-0">
                <LogoWordmark nav href={homeHref} />
                <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
                  {t("platform.mobile.beta")}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid size-11 place-items-center rounded-md text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
                aria-label={t("platform.mobile.close")}
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <PlatformNav
                initialSection={initialSection}
                currentNavigationHref={currentNavigationHref}
                navigationCounts={navigationCounts}
              />
            </div>
            <div className="border-t border-[var(--color-line)] p-3">
              <SessionCard />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
