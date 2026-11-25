"use client";

import { usePathname } from "next/navigation";
import { useId, useState, type ReactNode, type SyntheticEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformHeader } from "@/components/platform/platform-header";
import { PlatformNav, resolveContext } from "@/components/platform/platform-nav";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { isFramedPlatformRoute } from "@/components/platform/platform-routes";
import { SidebarToggle } from "@/components/platform/sidebar-toggle";
import { StatusBanner } from "@/components/platform/status-banner";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { useTeacherInboxCount } from "@/components/teacher/use-teacher-inbox-count";
import type { PlatformNavCounts } from "@/data/site";
import { getWorkspaceHomeHref } from "@/lib/auth/routing";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { useSidebarState } from "@/lib/ui/sidebar-state";

type PlatformShellProps = {
  /** Title is always required: it is the page identity in the sidebar grid. */
  title: string;
  /** Small uppercase label above the title. Optional. */
  eyebrow?: string;
  /** One-paragraph context line below the title. Optional. */
  description?: string;
  /**
   * Compact variant: smaller title, tighter padding. Use for inner pages
   * where a tab/breadcrumb already gives context. (In the studio the title has a
   * single size; compact only tightens the spacing.)
   */
  compact?: boolean;
  /** Some surfaces, like Studio and Builder, own their own richer header. */
  hideHeader?: boolean;
  /** Query-based workspaces resolve their active destination in the page. */
  currentNavigationHref?: string;
  searchHref?: string | null;
  navigationCounts?: PlatformNavCounts;
  children: ReactNode;
};

export function PlatformShell({
  eyebrow,
  title,
  description,
  compact = false,
  hideHeader = false,
  currentNavigationHref,
  searchHref,
  navigationCounts: pageCounts,
  children,
}: PlatformShellProps) {
  const { user } = useAuth();
  const { isRail, isCollapsed, isAuto, toggle } = useSidebarState();
  const navId = useId();
  const pathname = usePathname() ?? "";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileNavSection, setMobileNavSection] = useState<string>();
  // The number of pending items next to "Inbox", on every teacher page.
  const teacherSide = Boolean(user) && resolveContext(pathname, { roles: user?.roles ?? ["guest"] }) === "teacher";
  const inboxPending = useTeacherInboxCount(teacherSide ? user?.uid ?? null : null);
  const navigationCounts = inboxPending
    ? { ...pageCounts, "/teach/messages": inboxPending }
    : pageCounts;
  // By address, not by role: the width already comes right in the server HTML,
  // without waiting for login to load (the column does not change width on screen).
  const teachRoute = pathname === "/teach" || pathname.startsWith("/teach/");
  // Which screens get the 1280px column: the rule lives in platform-routes.ts,
  // which the login guard's wait screen also reads.
  const framed = isFramedPlatformRoute(pathname);

  return (
    <ThemeProvider>
      <main className="page-shell platform-shell-root">
        <StatusBanner />
        <div className="platform-shell-body">
          <div className="platform-shell-inner w-full">
            <div
              className={[
                "platform-grid",
                isCollapsed ? "platform-grid--collapsed" : "",
                // With no saved choice, the 1st frame's width comes from the CSS.
                isAuto ? "platform-grid--auto" : "",
              ].join(" ")}
            >
              <aside
                className={`platform-sidebar platform-sidebar-panel ${
                  isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"
                }`}
                onMouseOver={(event) => placeSidebarTip(event, isCollapsed)}
                onFocus={(event) => placeSidebarTip(event, isCollapsed)}
                // The list scrolled: the tooltip would stay in the old place. It disappears, and
                // the next hover or focus measures again.
                onScrollCapture={(event) => hideSidebarTips(event.currentTarget)}
              >
                <SidebarBrand
                  collapsed={isCollapsed}
                  auto={isAuto}
                  href={getWorkspaceHomeHref(pathname, user)}
                >
                  <SidebarToggle collapsed={isCollapsed} controls={navId} onToggle={toggle} />
                </SidebarBrand>
                <PlatformNav
                  id={navId}
                  collapsed={isCollapsed}
                  currentNavigationHref={currentNavigationHref}
                  navigationCounts={navigationCounts}
                  onRequestExpand={(section) => {
                    if (isRail) {
                      setMobileNavSection(section);
                      setMobileNavOpen(true);
                    } else {
                      toggle();
                    }
                  }}
                />
              </aside>

              <div className="platform-main-column">
                <PlatformHeader currentNavigationHref={currentNavigationHref} searchHref={searchHref} />
                {/* The section is still the one that scrolls (the scrollbar sits at the
                    window edge); the inner frame is what limits the width. */}
                <section className="platform-content">
                  <div
                    className={[
                      compact ? "space-y-4" : "space-y-6",
                      // Studio, account and learner lists: a column of at most
                      // 1280px, centered. On a 1920px monitor the sales list
                      // had the title at the left edge and the value
                      // 1500px later. Only from 1440px: below that
                      // no screen gets narrower than before.
                      framed ? "mx-auto w-full min-[1440px]:max-w-7xl" : "",
                    ].join(" ")}
                  >
                    {/* The new header is studio-only. Learner classroom, account,
                        support and internal panel keep the previous one. */}
                    {hideHeader ? null : teachRoute ? (
                      <PlatformPageHeader
                        eyebrow={eyebrow}
                        title={title}
                        description={description}
                        compact={compact}
                      />
                    ) : (
                      <div
                        className={`platform-page-heading ${
                          compact ? "platform-page-heading--compact" : ""
                        }`}
                      >
                        {eyebrow ? (
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                            {eyebrow}
                          </p>
                        ) : null}
                        <h1
                          className={
                            compact
                              ? "display-title max-w-4xl text-xl leading-tight text-[var(--color-primary)] sm:text-2xl lg:text-3xl"
                              : `display-title ${
                                  eyebrow ? "mt-3" : ""
                                } max-w-4xl text-3xl leading-tight text-[var(--color-primary)] sm:text-4xl lg:text-5xl`
                          }
                        >
                          {title}
                        </h1>
                        {description ? (
                          <p
                            className={`max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)] ${
                              compact ? "mt-2" : "mt-3"
                            }`}
                          >
                            {description}
                          </p>
                        ) : null}
                      </div>
                    )}
                    {children}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
        <MobileSidebarDrawer
          open={mobileNavOpen}
          initialSection={mobileNavSection}
          currentNavigationHref={currentNavigationHref}
          navigationCounts={navigationCounts}
          onOpen={() => {
            setMobileNavSection(undefined);
            setMobileNavOpen(true);
          }}
          onClose={() => setMobileNavOpen(false)}
        />
      </main>
    </ThemeProvider>
  );
}

// The collapsed rail's tooltip (the item name) is `position: fixed`: the list scrolls and
// would clip an absolute tooltip. The item says where it goes, on hover and on focus; the
// CSS only shows it after this (`[style]` selector). One measurement per hover.
// One tooltip at a time: measuring one item erases the measurement of the others, so keyboard
// focus on one item and the mouse on another do not show two. When open, only the ☰ has a tooltip.
function placeSidebarTip(event: SyntheticEvent<HTMLElement>, collapsed: boolean) {
  const item = (event.target as Element).closest?.(".platform-nav-link");
  if (!(item instanceof HTMLElement)) return;
  if (!collapsed && !item.classList.contains("platform-sidebar-toggle")) return;
  hideSidebarTips(event.currentTarget, item);
  const box = item.getBoundingClientRect();
  item.style.setProperty("--tip-x", `${Math.round(box.right + 16)}px`);
  item.style.setProperty("--tip-y", `${Math.round(box.top + box.height / 2)}px`);
}

// Without `style`, the CSS does not show the tooltip. No item in the bar has another inline
// style: only this measurement.
function hideSidebarTips(sidebar: HTMLElement, keep?: Element) {
  sidebar.querySelectorAll(".platform-nav-link[style]").forEach((item) => {
    if (item !== keep) item.removeAttribute("style");
  });
}

// The ☰ and the brand. Collapsed, the wide brand goes away. The small one only appears from 768 to
// 1023px (CSS), where the ☰ disappears and the top bar still has no logo: the rail is never
// left without a brand or without a path to home. With no saved choice it already comes in the
// server HTML, so the tablet's 1st frame has the brand. Without `priority`:
// where it is hidden, the browser does not download it.
function SidebarBrand({
  collapsed,
  auto,
  href,
  children,
}: {
  collapsed: boolean;
  auto: boolean;
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="platform-sidebar-brand">
      {children}
      {collapsed || auto ? (
        <LogoWordmark
          href={href}
          nav
          variant="mark"
          tone="dark"
          priority={false}
          className="platform-sidebar-brand__mark"
        />
      ) : null}
      {collapsed ? null : (
        <LogoWordmark
          href={href}
          nav
          tone="dark"
          className="platform-sidebar-brand__lockup-link"
        />
      )}
    </div>
  );
}
