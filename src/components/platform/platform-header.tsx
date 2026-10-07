"use client";

import { usePathname } from "next/navigation";
import { ArrowLeftRight, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { HelpMenu } from "@/components/platform/help-menu";
import { NotificationBell } from "@/components/platform/notification-bell";
import { PlatformSearch } from "@/components/platform/platform-search";
import { AccountMenu } from "@/components/site/account-menu";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AdvisorHeaderSlot } from "@/components/teacher/advisor-sidebar";
import { isPlatformNavItemHidden, platformNav } from "@/data/site";
import { getWorkspaceHomeHref, getWorkspaceSide } from "@/lib/auth/routing";
import { hasPermission, type PermissionSubject } from "@/lib/permissions";

// O hambúrguer daqui foi embora: abaixo de 640px ele abria EXATAMENTE a mesma
// gaveta que o "More" da barra de baixo, que está sempre visível e ao alcance
// do polegar. Duas portas para a mesma sala, uma delas no canto oposto ao da
// mão. De 640px para cima ele já era `sm:hidden`, então nada muda ali.
export function PlatformHeader({ currentNavigationHref, searchHref }: {
  currentNavigationHref?: string;
  searchHref?: string | null;
}) {
  const pathname = usePathname() ?? "";
  const { t } = useTranslation();
  const { status, user, signOut } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const surface = getSurface(pathname);
  const pageLabel = getPageLabel(pathname, t, currentNavigationHref, { roles: user?.roles });
  const showSearch = searchHref !== null && (!pathname.startsWith("/ops") || Boolean(searchHref));
  const signedIn = status === "authenticated" && Boolean(user);
  const side = getWorkspaceSide(pathname, user);
  // Trocar de lado era "Switch view", escondido no menu do avatar, e o atalho
  // do site publico abria ABA NOVA — para quem tem pouca familiaridade com a
  // internet, aba nova e "o site sumiu". Agora e um botao a vista, na mesma aba.
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
        {/* No celular o caminho acima some (falta espaco): fica o nome do lado
            em que a pessoa esta. */}
        {signedIn ? <p className="platform-topbar__side">{t(`platform.side.${side}`)}</p> : null}

        {showSearch ? <PlatformSearch pathname={pathname} open={searchOpen} searchHref={searchHref ?? undefined} /> : null}

        <div className="platform-topbar__actions">
          {switchTo ? (
            <Link href={switchTo.href} className="platform-topbar__switch">
              <ArrowLeftRight aria-hidden="true" size={16} strokeWidth={1.9} />
              <span>{switchTo.label}</span>
            </Link>
          ) : null}
          {signedIn ? (
            <HelpMenu
              variant="bar"
              side={side === "teacher" ? "teacher" : "student"}
              className="platform-topbar__help"
            />
          ) : null}
          {/* No celular o campo não cabe na linha: o ícone o abre logo abaixo
              da barra. Em telas maiores ele já está aberto e este botão some. */}
          {showSearch ? <button
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
            <AccountMenu user={user} onSignOut={signOut} />
          ) : null}
          {/* O idioma só existia no site público: dentro de /teach, /learn,
              /account e /ops a pessoa tinha que sair da plataforma para trocar.
              Último item do cluster, no extremo direito — onde o olho procura.
              Todas as quatro superfícies passam por este mesmo cabeçalho. */}
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
