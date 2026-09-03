"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Calendar,
  ChevronDown,
  CreditCard,
  ExternalLink,
  GraduationCap,
  Handshake,
  House,
  Image,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  PenTool,
  PackageOpen,
  Plug,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  TrendingUp,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { platformNav, type PlatformNavContext } from "@/data/site";
import { hasPermission, type PermissionSubject } from "@/lib/permissions";

const iconMap: Record<string, LucideIcon> = {
  Award,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Calendar,
  CreditCard,
  GraduationCap,
  Handshake,
  House,
  Image,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  PenTool,
  PackageOpen,
  Plug,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  TrendingUp,
  UserCheck,
  Users,
};

// Chaves de `platform.navSection.*`; o rotulo visivel sai do dicionario.
const sectionOrder = [
  "home",
  "products",
  "marketing",
  "sales",
  "earnings",
  "reports",
  "growth",
  "tools",
  "myLearning",
  "discover",
  "learn",
  "operations",
  "account",
];

// "Operations" era um grupo com um único item, também chamado "Operations":
// clicar para abrir e ver o mesmo nome. Grupo de item único vira item direto.
const directSections = new Set([
  "home",
  "earnings",
  "myLearning",
  "discover",
  "operations",
]);

const sectionIconMap: Record<string, LucideIcon> = {
  discover: ShoppingBag,
  home: House,
  learn: GraduationCap,
  myLearning: BookOpen,
  products: PackageOpen,
  marketing: Megaphone,
  sales: Receipt,
  earnings: TrendingUp,
  reports: BarChart3,
  growth: Users,
  tools: Settings,
  operations: UserCheck,
  account: Settings,
};

type PlatformNavProps = {
  collapsed?: boolean;
  onRequestExpand?: () => void;
};

export function PlatformNav({ collapsed = false, onRequestExpand }: PlatformNavProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const panelIdPrefix = useId();
  // Antes isto guardava UMA seção: abrir um grupo fechava todos os outros.
  // Medido no /teach, com 6 grupos: nunca havia mais de 7 a 9 links visíveis,
  // então o criador nunca via o mapa do produto — precisava abrir, memorizar e
  // fechar. Foi assim que /teach/media e /teach/sales ficaram sem caminho
  // algum a partir do estado inicial. Agora o conjunto é aberto, e abrir um
  // grupo não custa fechar outro.
  const [sectionChoice, setSectionChoice] = useState<{
    pathname: string;
    sections: string[] | null;
  }>({ pathname: "", sections: null });
  const subject: PermissionSubject = { roles: user?.roles ?? ["guest"] };
  const context = resolveContext(pathname, subject);

  const visibleItems = platformNav
    .filter(
      (item) =>
        item.contexts.includes(context) &&
        (!item.permission || hasPermission(subject, item.permission))
    )
    .sort((a, b) => {
      const sectionDelta = getSectionRank(a.sectionKey) - getSectionRank(b.sectionKey);

      if (sectionDelta !== 0) {
        return sectionDelta;
      }

      return platformNav.indexOf(a) - platformNav.indexOf(b);
    });

  const groups: Array<{ section: string; items: typeof visibleItems }> = [];
  for (const item of visibleItems) {
    const currentGroup = groups.at(-1);
    if (!currentGroup || currentGroup.section !== item.sectionKey) {
      groups.push({ section: item.sectionKey, items: [item] });
    } else {
      currentGroup.items.push(item);
    }
  }

  const activeSection = groups.find((group) =>
    group.items.some((item) => isActivePlatformRoute(pathname, item.href))
  )?.section;
  const activeAccordionSection = groups.find(
    (group) =>
      !directSections.has(group.section) &&
      group.items.some((item) => isActivePlatformRoute(pathname, item.href))
  )?.section;
  const firstAccordionSection = groups.find((group) => !directSections.has(group.section))?.section;
  // Padrão: o grupo da rota atual aberto (ou o primeiro), como antes. A
  // diferença é que a partir daí o usuário acumula grupos abertos.
  const defaultSections = [activeAccordionSection ?? firstAccordionSection]
    .filter((section): section is string => Boolean(section));
  const expandedSections =
    sectionChoice.pathname === pathname && sectionChoice.sections
      ? sectionChoice.sections
      : defaultSections;

  function toggleSection(section: string) {
    if (collapsed) {
      setSectionChoice({ pathname, sections: [section] });
      onRequestExpand?.();
      return;
    }

    setSectionChoice({
      pathname,
      sections: expandedSections.includes(section)
        ? expandedSections.filter((open) => open !== section)
        : [...expandedSections, section],
    });
  }

  return (
    <nav
      className="platform-sidebar-nav mt-3 flex flex-col"
      aria-label={t("platform.sidebarNavLabel")}
    >
      {groups.map((group) => {
        if (directSections.has(group.section) && group.items.length === 1) {
          const item = group.items[0];

          return (
            <div className="platform-nav-section shrink-0" key={group.section}>
              <PlatformNavLink
                href={item.href}
                label={t(item.labelKey)}
                icon={item.icon}
                active={isActivePlatformRoute(pathname, item.href)}
                newTab={item.newTab}
                collapsed={collapsed}
              />
            </div>
          );
        }

        const SectionIcon = sectionIconMap[group.section] ?? LayoutDashboard;
        // Os grupos saiam em ingles cru ("Products", "Sales") em toda lingua,
        // e a dica do icone recolhido tambem era montada a mao em ingles.
        const sectionLabel = t(`platform.navSection.${group.section}`);
        const isActiveSection = group.section === activeSection;
        const isExpanded = !collapsed && expandedSections.includes(group.section);
        const panelId = `${panelIdPrefix}-${group.section}`;

        return (
          <div className="platform-nav-section shrink-0" key={group.section}>
            <button
              type="button"
              onClick={() => toggleSection(group.section)}
              aria-controls={collapsed ? undefined : panelId}
              aria-expanded={collapsed ? undefined : isExpanded}
              aria-label={
                collapsed ? t("platform.openSectionNav").replace("{section}", sectionLabel) : undefined
              }
              title={collapsed ? sectionLabel : undefined}
              className={`platform-nav-link platform-nav-section-trigger group relative flex w-full shrink-0 items-center rounded-[10px] border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                collapsed ? "justify-center px-0" : "px-2"
              } ${
                collapsed && isActiveSection
                  ? "platform-nav-active"
                  : isActiveSection
                    ? "platform-nav-section-active"
                    : ""
              }`}
            >
              {/* Recolhida, o item e o unico quadrado: sem o chip do icone
                  (era a segunda camada no hover; ver bloco "Rail recolhido"
                  no globals.css). */}
              {collapsed ? (
                <SectionIcon aria-hidden="true" size={18} strokeWidth={2} />
              ) : (
                <span className="platform-nav-icon-chip">
                  <SectionIcon aria-hidden="true" size={17} strokeWidth={2} />
                </span>
              )}
              <span className="platform-sidebar-label min-w-0 truncate">{sectionLabel}</span>
              {!collapsed ? (
                <ChevronDown
                  aria-hidden="true"
                  size={15}
                  strokeWidth={2}
                  className={`platform-nav-section-chevron ${isExpanded ? "is-open" : ""}`}
                />
              ) : null}
            </button>

            {isExpanded ? (
              <div id={panelId} className="platform-nav-section-items" data-section={group.section}>
                {group.items.map((item) => (
                  <PlatformNavLink
                    key={item.href}
                    href={item.href}
                    label={t(item.labelKey)}
                    icon={item.icon}
                    active={isActivePlatformRoute(pathname, item.href)}
                    newTab={item.newTab}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function getSectionRank(section: string) {
  const index = sectionOrder.indexOf(section);
  return index === -1 ? sectionOrder.length : index;
}

function resolveContext(pathname: string, subject: PermissionSubject): PlatformNavContext {
  if (pathname.startsWith("/learn")) {
    return "learner";
  }

  if (pathname.startsWith("/teach")) {
    return "teacher";
  }

  if (pathname.startsWith("/ops")) {
    return "ops";
  }

  if (hasPermission(subject, "platform.accessAdmin")) {
    return "ops";
  }

  if (hasPermission(subject, "teacherStudio.access")) {
    return "teacher";
  }

  return "learner";
}

function isActivePlatformRoute(pathname: string, href: string) {
  if (href === "/teach/builder" && pathname.startsWith("/teach/courses/")) {
    return true;
  }

  if (href === "/account") {
    return (
      pathname === "/account" ||
      pathname.startsWith("/account/profile") ||
      pathname.startsWith("/account/email") ||
      pathname.startsWith("/account/security") ||
      pathname.startsWith("/account/notifications")
    );
  }

  if (["/learn", "/teach", "/ops"].includes(href)) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function PlatformNavLink({
  href,
  label,
  icon,
  active,
  newTab = false,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  newTab?: boolean;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = iconMap[icon] ?? LayoutDashboard;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Recolhida, a barra esconde o rótulo (largura 0) e o ícone ficava sem
      // nome: só os grupos tinham dica. O title devolve o nome no hover; o
      // rótulo continua no DOM para leitores de tela.
      title={collapsed ? label : undefined}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className={`platform-nav-link group relative flex h-11 min-h-11 shrink-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        active
          ? "platform-nav-active border-[rgba(24,58,94,0.2)] shadow-[0_10px_22px_rgba(26,54,93,0.16)]"
          : "border-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]"
      }`}
    >
      {collapsed ? (
        <Icon aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
      ) : (
        <span className="platform-nav-icon-chip">
          <Icon aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
        </span>
      )}
      <span className="platform-sidebar-label min-w-0 truncate">{label}</span>
      {newTab ? (
        <ExternalLink
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
          className="ml-auto shrink-0 text-[var(--color-ink-muted)] transition-colors group-hover:text-[var(--color-ink-soft)]"
        />
      ) : null}
      {newTab ? <span className="sr-only">{t("platform.opensInNewTab")}</span> : null}
    </Link>
  );
}
