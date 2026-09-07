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
  ClipboardList,
  CreditCard,
  ExternalLink,
  Flag,
  GraduationCap,
  Handshake,
  House,
  Image,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  PenTool,
  PackageOpen,
  Plug,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShieldCheck,
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
import {
  canAccessPlatformNavItem,
  getOpsNavItem,
  platformNav,
  type PlatformNavContext,
  type PlatformNavCount,
  type PlatformNavCounts,
} from "@/data/site";
import { hasPermission, type PermissionSubject } from "@/lib/permissions";

const iconMap: Record<string, LucideIcon> = {
  Award,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Calendar,
  ClipboardList,
  CreditCard,
  Flag,
  GraduationCap,
  Handshake,
  House,
  Image,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  PenTool,
  PackageOpen,
  Plug,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tag,
  TrendingUp,
  UserCheck,
  Users,
};

// Chaves de `platform.navSection.*`; o rotulo visivel sai do dicionario.
// Primeiro a lista plana do trabalho do dia (Home, Produtos, Vendas,
// Assinaturas, Ganhos, Relatórios), depois os dois únicos grupos que sobraram,
// e por último o rodapé.
const sectionOrder = [
  "home",
  "products",
  "sales",
  "earnings",
  "reports",
  "marketing",
  "tools",
  "learn",
  "operations",
  "account",
  // Rodapé — ver `footerSections`.
  "myLearning",
  "discover",
];

// Seções que NÃO viram acordeão: cada item vira uma linha direta da barra.
//
// Antes só o grupo de item único escapava ("Operations" abria para mostrar
// "Operations"). Products, Sales e Reports continuavam como gaveta de um ou
// dois links, então chegar em "Vendas" custava um clique para abrir e outro
// para ir — e, fechada a gaveta, a pessoa não via que a tela existia. Com a
// lista plana, Produtos, Vendas, Assinaturas, Ganhos e Relatórios estão
// sempre à vista. Marketing e Tools seguem em grupo: são caudas longas
// (5 e 3 itens) que só se consulta de vez em quando.
const directSections = new Set([
  "home",
  "products",
  "sales",
  "earnings",
  "reports",
  "myLearning",
  "discover",
  "operations",
]);

// Descoberta e "o que eu estudo" não são o trabalho de produzir: vão para o pé
// da barra, separados por uma linha, em vez de disputar o topo com Produtos.
const footerSections = new Set(["myLearning", "discover"]);

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
  tools: Settings,
  operations: UserCheck,
  account: Settings,
};

type PlatformNavProps = {
  collapsed?: boolean;
  onRequestExpand?: (section: string) => void;
  initialSection?: string;
  currentNavigationHref?: string;
  navigationCounts?: PlatformNavCounts;
};

export function PlatformNav({
  collapsed = false,
  onRequestExpand,
  initialSection,
  currentNavigationHref,
  navigationCounts,
}: PlatformNavProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const activeHref = currentNavigationHref ?? (pathname === "/ops" ? getOpsNavItem(null).href : pathname);
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
  }>({ pathname, sections: initialSection ? [initialSection] : null });
  const subject: PermissionSubject = { roles: user?.roles ?? ["guest"] };
  const context = resolveContext(pathname, subject);

  const visibleItems = platformNav
    .filter(
      (item) =>
        item.contexts.includes(context) &&
        canAccessPlatformNavItem(subject, item)
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
    group.items.some((item) => isActivePlatformRoute(pathname, item.href, activeHref))
  )?.section;
  const activeAccordionSection = groups.find(
    (group) =>
      !directSections.has(group.section) &&
      group.items.some((item) => isActivePlatformRoute(pathname, item.href, activeHref))
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
      onRequestExpand?.(section);
      return;
    }

    setSectionChoice({
      pathname,
      sections: expandedSections.includes(section)
        ? expandedSections.filter((open) => open !== section)
        : [...expandedSections, section],
    });
  }

  const mainGroups = groups.filter((group) => !footerSections.has(group.section));
  const footerGroups = groups.filter((group) => footerSections.has(group.section));

  function renderGroup(group: (typeof groups)[number]) {
    if (directSections.has(group.section)) {
      return (
        <div className="platform-nav-section shrink-0" key={group.section}>
          {group.items.map((item) => (
            <PlatformNavLink
              key={`${item.href}-${item.labelKey}`}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={isActivePlatformRoute(pathname, item.href, activeHref)}
              newTab={item.newTab}
              collapsed={collapsed}
              count={navigationCounts?.[item.href]}
            />
          ))}
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
          className={`platform-nav-link platform-nav-section-trigger group relative flex w-full shrink-0 items-center rounded-[10px] border text-sm font-semibold transition-colors ${
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
                active={isActivePlatformRoute(pathname, item.href, activeHref)}
                newTab={item.newTab}
                count={navigationCounts?.[item.href]}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <nav
      className="platform-sidebar-nav mt-3 flex flex-1 flex-col"
      aria-label={t("platform.sidebarNavLabel")}
    >
      {mainGroups.map(renderGroup)}
      {footerGroups.length ? (
        <div className="platform-nav-footer mt-auto shrink-0">
          {footerGroups.map(renderGroup)}
        </div>
      ) : null}
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

function isActivePlatformRoute(pathname: string, href: string, activeHref: string) {
  if (href.includes("?")) return href === activeHref;

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
  count,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  newTab?: boolean;
  collapsed?: boolean;
  count?: PlatformNavCount;
}) {
  const { t } = useTranslation();
  const Icon = iconMap[icon] ?? LayoutDashboard;
  const countLabel = count === undefined
    ? undefined
    : typeof count === "number"
      ? t("platform.queueCount.pending").replace("{count}", String(count))
      : t(`platform.queueCount.${count}`);
  const countText = typeof count === "number"
    ? (count > 99 ? "99+" : count)
    : count === "loading" ? "…" : "—";

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Recolhida, a barra esconde o rótulo (largura 0) e o ícone ficava sem
      // nome: só os grupos tinham dica. O title devolve o nome no hover; o
      // rótulo continua no DOM para leitores de tela.
      title={collapsed ? [label, countLabel].filter(Boolean).join(", ") : undefined}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className={`platform-nav-link group relative flex h-11 min-h-11 shrink-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "platform-nav-active border-[rgba(24,58,94,0.2)] shadow-[0_10px_22px_rgba(26,54,93,0.16)]"
          : "border-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]"
      }`}
    >
      {collapsed ? (
        <Icon
          aria-hidden="true"
          size={18}
          strokeWidth={2}
          className={count === undefined ? "shrink-0" : "shrink-0 -translate-y-2"}
        />
      ) : (
        <span className="platform-nav-icon-chip">
          <Icon aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
        </span>
      )}
      <span className="platform-sidebar-label min-w-0 truncate">{label}</span>
      {count !== undefined ? (
        <>
          <span
            aria-hidden="true"
            className={`shrink-0 rounded-[4px] bg-[var(--color-surface-soft)] px-1 text-center font-semibold tabular-nums text-[var(--color-ink)] ${
              collapsed
                ? "absolute bottom-1 left-1/2 h-3.5 min-w-5 -translate-x-1/2 text-[10px] leading-3.5"
                : "ml-auto h-5 min-w-5 text-[11px] leading-5"
            }`}
          >
            {countText}
          </span>
          <span className="sr-only">, {countLabel}</span>
        </>
      ) : null}
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
