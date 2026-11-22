"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { PublicEntryMenu } from "@/components/site/public-entry-menu";
import { useHasRealCourses } from "@/components/site/real-courses";
import { AccountMenu } from "@/components/site/account-menu";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { LayoutDashboard, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useModalFocus } from "@/lib/a11y/use-modal-focus";
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

// The same menu on every page, the home included (2026-11-13: the home used to
// scroll to its own sections and had no "Help").
type ResolvedNavItem = {
  key: string;
  label: string;
  target: string;
};

function resolveNavItems(
  t: (key: string) => string,
  marketplaceOpen: boolean,
): ResolvedNavItem[] {
  // Vitrine fechada (menos de 12 cursos de 5 professores) não ganha porta no menu.
  return navItems.filter((item) => marketplaceOpen || item.href !== "/courses").map((item) => ({
    key: item.href,
    label: t(item.labelKey),
    target: item.href,
  }));
}

function isActiveNav(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav() {
  const { status, user, signOut } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const headerRowRef = useRef<HTMLDivElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const resolvedNav = resolveNavItems(t, useHasRealCourses());
  const isAuthenticated = status === "authenticated" && user;
  // Estável, para o efeito do foco não rodar de novo a cada render.
  const focusMenuToggle = useCallback(() => mobileToggleRef.current, []);

  // Menu aberto se comporta como janela: o Tab anda pelos itens e pela barra
  // do topo (logo, X, idioma) e volta, sem cair na página escurecida atrás; ao
  // fechar, o foco volta ao botão do menu.
  useModalFocus(headerRowRef, mobileOpen, focusMenuToggle);

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

    // A partir de 1280px o painel, o escuro e o X somem (xl:hidden). Se a
    // janela cresce com o menu aberto (tablet girado, janela maximizada), o
    // menu fecha junto: senão a página ficava travada e o Tab preso na barra,
    // sem botão visível para soltar.
    const desktop = window.matchMedia?.("(min-width: 1280px)");
    if (desktop?.matches) {
      // Sincroniza com um sistema externo (a largura da janela).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobileOpen(false);
      return;
    }
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setMobileOpen(false);
    }
    desktop?.addEventListener("change", closeOnDesktop);

    // O foco entra no primeiro item; antes ficava no X e o Tab passava pela
    // página de trás antes de chegar ao menu.
    mobilePanelRef.current
      ?.querySelector<HTMLElement>("a[href], button:not([disabled])")
      ?.focus();
    // A página de trás não rola por baixo do menu aberto.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        mobileToggleRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      desktop?.removeEventListener("change", closeOnDesktop);
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Primeiro elemento focável da página: quem navega pelo teclado ou por
          leitor de tela pula a barra inteira. Invisível até receber foco. O
          alvo é o <main id="conteudo"> de cada página pública. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-[var(--color-primary)] focus:shadow-[var(--shadow-soft)]"
      >
        {t("nav.skipToContent")}
      </a>
      <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <div ref={headerRowRef} className="site-header__inner relative">
        <div className="hidden md:block">
          <LogoWordmark nav />
        </div>
        <div className="md:hidden">
          <LogoWordmark nav variant="mark" />
        </div>
        <nav
          aria-label={t("nav.primaryNavLabel")}
          className="site-header__links"
        >
          {resolvedNav.map((item) => {
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
        {/* Dois estilos só, iguais na barra e no menu do celular: a ação
            principal em .button-solid (navy) e "Sign in" em contorno. Antes a
            barra usava o botão dourado e o menu o navy, e na home o dourado da
            barra ficava logo acima do dourado do hero (dois primários iguais). */}
        <div className="site-header__actions">
          {isAuthenticated ? (
            <>
              <div className="hidden lg:block">
                <Link
                  href={getPrimaryWorkspaceHref(user)}
                  className="button-solid gap-2 px-3 xl:px-4"
                >
                  <LayoutDashboard aria-hidden="true" size={16} strokeWidth={1.9} />
                  {t("nav.dashboard")}
                </Link>
              </div>
              <AccountMenu user={user} onSignOut={signOut} />
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <PublicEntryMenu />
              <Link href="/auth?mode=signup" className="button-solid px-3 xl:px-4">
                {t("nav.getStarted")}
              </Link>
            </div>
          )}
          <button
            ref={mobileToggleRef}
            type="button"
            aria-label={mobileOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={mobileOpen}
            aria-controls="site-mobile-menu"
            onClick={() => setMobileOpen((open) => !open)}
            className="grid size-11 shrink-0 place-items-center rounded-md border border-[var(--color-line)] bg-white text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] xl:hidden"
          >
            {mobileOpen ? (
              <X aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <Menu aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </button>
          {/* Idioma no extremo direito da barra, e não no meio das ações de
              entrada: é lá que o olho procura. O rodapé mantém a cópia dele
              para quem rola até o fim. */}
          <LocaleSwitcher variant="compact" />
        </div>

        {mobileOpen ? (
            <div
              ref={mobilePanelRef}
              id="site-mobile-menu"
              className="motion-drop-in absolute inset-x-0 top-[calc(100%+8px)] z-[46] max-h-[calc(100svh-88px)] scroll-py-2 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-white p-3 shadow-[0_24px_48px_rgba(15,39,68,0.16)] xl:hidden"
            >
              <nav aria-label={t("nav.mobileNavLabel")} className="grid gap-1">
                {resolvedNav.map((item) => {
                  const baseClass =
                    "rounded-md px-3 py-3 text-sm font-semibold transition-colors";

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
                  <PublicEntryMenu mobile />
                  <Link
                    href="/auth?mode=signup"
                    className="button-solid w-full px-4 py-2.5 text-sm"
                  >
                    {t("nav.getStarted")}
                  </Link>
                </div>
              )}
            </div>
        ) : null}
      </div>
      </header>
      {mobileOpen ? (
        // O escuro fica fora do <header>: o backdrop-filter da barra prende um
        // `fixed` dentro dela, e o escuro cobria a própria barra. Aqui ele
        // começa abaixo do topo (logo e X nítidos) e fica sob a barra (z 39 <
        // 40). Não é focável: o X e o Esc fecham pelo teclado.
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-x-0 bottom-0 top-[var(--site-header-height)] z-[39] bg-[rgba(15,39,68,0.4)] xl:hidden"
        />
      ) : null}
      {/* A barra é fixa, logo saiu do fluxo. Esta faixa devolve a altura dela
          para a página, de uma vez só, em vez de cada rota lembrar de reservar
          um padding no topo. */}
      <div aria-hidden="true" className="site-header-spacer" />
    </>
  );
}
