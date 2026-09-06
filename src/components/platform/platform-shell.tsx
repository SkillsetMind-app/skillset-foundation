"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformHeader } from "@/components/platform/platform-header";
import { PlatformNav } from "@/components/platform/platform-nav";
import { SidebarToggle } from "@/components/platform/sidebar-toggle";
import { StatusBanner } from "@/components/platform/status-banner";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
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
   * where a tab/breadcrumb already gives context.
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
  navigationCounts,
  children,
}: PlatformShellProps) {
  const { user } = useAuth();
  const { isRail, isCollapsed, persistentState, toggle } = useSidebarState();
  const pathname = usePathname() ?? "";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileNavSection, setMobileNavSection] = useState<string>();

  return (
    <ThemeProvider>
      <main className="page-shell platform-shell-root">
        <StatusBanner />
        <div className="platform-shell-body">
          <div className="platform-shell-inner w-full">
            <div
              className={`platform-grid ${
                isCollapsed ? "platform-grid--collapsed" : ""
              }`}
            >
              <aside
                className={`platform-sidebar platform-sidebar-panel ${
                  isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"
                }`}
              >
                <SidebarBrand
                  collapsed={isCollapsed}
                  href={getWorkspaceHomeHref(pathname, user)}
                />
                <PlatformNav
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
                {/* Último item da barra, dentro dela (mt-auto). O círculo
                    flutuante na borda ficava em cima da linha que separa barra
                    e conteúdo, como um elemento perdido. */}
                <SidebarToggle
                  state={persistentState}
                  isCollapsed={isCollapsed}
                  onToggle={toggle}
                />
              </aside>

              <div className="platform-main-column">
                <PlatformHeader currentNavigationHref={currentNavigationHref} searchHref={searchHref} />
                <section
                  className={`platform-content ${
                    compact ? "space-y-4" : "space-y-6"
                  }`}
                >
                  {hideHeader ? null : (
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

function SidebarBrand({ collapsed, href }: { collapsed: boolean; href: string }) {
  if (collapsed) {
    return (
      <div className="platform-sidebar-brand">
        <LogoWordmark
          href={href}
          nav
          variant="mark"
          tone="dark"
          className="platform-sidebar-brand__mark"
        />
      </div>
    );
  }

  return (
    <div className="platform-sidebar-brand">
      <LogoWordmark
        href={href}
        nav
        tone="dark"
        className="platform-sidebar-brand__lockup-link"
      />
    </div>
  );
}
