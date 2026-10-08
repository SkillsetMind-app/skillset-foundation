"use client";

import { usePathname } from "next/navigation";
import { useId, useState, type ReactNode, type SyntheticEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformHeader } from "@/components/platform/platform-header";
import { PlatformNav, resolveContext } from "@/components/platform/platform-nav";
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
  navigationCounts: pageCounts,
  children,
}: PlatformShellProps) {
  const { user } = useAuth();
  const { isRail, isCollapsed, isAuto, toggle } = useSidebarState();
  const navId = useId();
  const pathname = usePathname() ?? "";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileNavSection, setMobileNavSection] = useState<string>();
  // O numero de pendentes ao lado de "Inbox", em toda pagina do professor.
  const teacherSide = Boolean(user) && resolveContext(pathname, { roles: user?.roles ?? ["guest"] }) === "teacher";
  const inboxPending = useTeacherInboxCount(teacherSide ? user?.uid ?? null : null);
  const navigationCounts = inboxPending
    ? { ...pageCounts, "/teach/messages": inboxPending }
    : pageCounts;

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
                // Sem escolha salva, a largura do 1º quadro vem do CSS.
                isAuto ? "platform-grid--auto" : "",
              ].join(" ")}
            >
              <aside
                className={`platform-sidebar platform-sidebar-panel ${
                  isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"
                }`}
                onMouseOver={(event) => placeSidebarTip(event, isCollapsed)}
                onFocus={(event) => placeSidebarTip(event, isCollapsed)}
                // A lista rolou: a dica ficaria parada no lugar velho. Some, e
                // o próximo hover ou foco mede de novo.
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

// A dica do rail recolhido (o nome do item) é `position: fixed`: a lista rola e
// cortaria uma dica absoluta. O item diz onde ela fica, no hover e no foco; o
// CSS só a mostra depois disto (seletor `[style]`). Uma medida por hover.
// Uma dica por vez: medir um item apaga a medida dos outros, então o foco do
// teclado num item e o mouse em outro não mostram duas. Aberta, só o ☰ tem dica.
function placeSidebarTip(event: SyntheticEvent<HTMLElement>, collapsed: boolean) {
  const item = (event.target as Element).closest?.(".platform-nav-link");
  if (!(item instanceof HTMLElement)) return;
  if (!collapsed && !item.classList.contains("platform-sidebar-toggle")) return;
  hideSidebarTips(event.currentTarget, item);
  const box = item.getBoundingClientRect();
  item.style.setProperty("--tip-x", `${Math.round(box.right + 16)}px`);
  item.style.setProperty("--tip-y", `${Math.round(box.top + box.height / 2)}px`);
}

// Sem `style`, o CSS não mostra a dica. Nenhum item da barra tem outro estilo
// em linha: só esta medida.
function hideSidebarTips(sidebar: HTMLElement, keep?: Element) {
  sidebar.querySelectorAll(".platform-nav-link[style]").forEach((item) => {
    if (item !== keep) item.removeAttribute("style");
  });
}

// O ☰ e a marca. Recolhida, a marca larga sai. A pequena só aparece de 768 a
// 1023px (CSS), onde o ☰ some e a barra do topo ainda não tem logo: o rail não
// fica sem marca nem sem caminho para a home. Sem escolha salva ela já vem no
// HTML do servidor, para o 1º quadro do tablet ter a marca. Sem `priority`:
// onde está escondida, o navegador não a baixa.
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
