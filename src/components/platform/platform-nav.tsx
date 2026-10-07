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
  Flag,
  GraduationCap,
  Handshake,
  House,
  Image,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  PenTool,
  PackageOpen,
  Plug,
  Presentation,
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
import { HelpMenu } from "@/components/platform/help-menu";
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
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  PenTool,
  PackageOpen,
  Plug,
  Presentation,
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
// Professor: oito itens no primeiro nivel (Inicio, Produtos, Alunos, Caixa de
// entrada, Vendas, Ganhos, Promover, Ajuda). Aluno: quatro itens fixos e a
// Ajuda; embaixo, compras e configuracoes. "help" nao e uma secao de itens:
// marca onde o botao Ajuda entra na lista.
const sectionOrder = [
  "home",
  "products",
  "students",
  "inbox",
  "sales",
  "earnings",
  "promote",
  "learn",
  "help",
  "operations",
  "account",
  // Rodape — ver `footerSections`.
  "discover",
];

// Secoes que NAO viram acordeao: cada item vira uma linha direta da barra.
// So Vendas (vendas, assinaturas, relatorios) e Promover (marketing, loja,
// midia) seguem em grupo: sao o que se consulta de vez em quando, e assim o
// primeiro nivel cabe em oito itens.
const directSections = new Set([
  "home",
  "products",
  "students",
  "inbox",
  "earnings",
  "learn",
  "account",
  "discover",
  "operations",
]);

// Descoberta nao e o trabalho de produzir nem de estudar: vai para o pe da
// barra, separada por uma linha. A troca entre aluno e professor e o botao do
// topo, nao um link aqui.
const footerSections = new Set(["discover"]);

const sectionIconMap: Record<string, LucideIcon> = {
  discover: ShoppingBag,
  home: House,
  learn: GraduationCap,
  products: PackageOpen,
  promote: Megaphone,
  sales: Receipt,
  earnings: TrendingUp,
  operations: UserCheck,
  account: Settings,
};

type PlatformNavProps = {
  /** O botao ☰ aponta para esta lista (aria-controls). */
  id?: string;
  collapsed?: boolean;
  onRequestExpand?: (section: string) => void;
  initialSection?: string;
  currentNavigationHref?: string;
  navigationCounts?: PlatformNavCounts;
};

export function PlatformNav({
  id,
  collapsed = false,
  onRequestExpand,
  initialSection,
  currentNavigationHref,
  navigationCounts,
}: PlatformNavProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const activeHref = currentNavigationHref ?? (pathname === "/ops" ? getOpsNavItem(null, user).href : pathname);
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
  // Ajuda entra logo depois do trabalho do dia (Promover / os itens fixos do
  // aluno) e antes de compras e configuracoes. E a UNICA Ajuda da tela (nem o
  // topo nem o menu do avatar repetem). A equipe de operacoes nao tem Ajuda:
  // as escolhas falam com aluno e professor, nao com o suporte.
  const helpRank = getSectionRank("help");
  const beforeHelp = mainGroups.filter((group) => getSectionRank(group.section) < helpRank);
  const afterHelp = mainGroups.filter((group) => getSectionRank(group.section) > helpRank);
  const help = context === "ops" ? null : (
    <div className="platform-nav-section shrink-0" key="help">
      <HelpMenu
        variant="nav"
        side={context === "teacher" ? "teacher" : "student"}
        collapsed={collapsed}
        // Recolhida, a Ajuda não abre no lugar (abre a barra ou a gaveta),
        // como os grupos: não diz "expandida" depois que a gaveta fecha.
        open={!collapsed && expandedSections.includes("help")}
        onOpenChange={() => toggleSection("help")}
        autoFocus={initialSection === "help"}
      />
    </div>
  );

  function renderGroup(group: (typeof groups)[number]) {
    if (directSections.has(group.section)) {
      return (
        <div className="platform-nav-section shrink-0" key={group.section} data-section={group.section}>
          {group.items.map((item) => (
            <PlatformNavLink
              key={`${item.href}-${item.labelKey}`}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={isActivePlatformRoute(pathname, item.href, activeHref)}
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
          className={`platform-nav-link platform-nav-section-trigger group relative flex w-full shrink-0 items-center rounded-md border text-sm font-semibold transition-colors ${
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
              no globals.css). O rotulo abaixo vira a dica no hover e no
              foco do teclado. */}
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
      id={id}
      className="platform-sidebar-nav mt-3 flex flex-1 flex-col"
      aria-label={t("platform.sidebarNavLabel")}
    >
      {beforeHelp.map(renderGroup)}
      {help}
      {afterHelp.map(renderGroup)}
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

export function resolveContext(pathname: string, subject: PermissionSubject): PlatformNavContext {
  if (pathname.startsWith("/learn")) {
    return "learner";
  }

  if (pathname.startsWith("/teach")) {
    return "teacher";
  }

  if (pathname.startsWith("/ops")) {
    return "ops";
  }

  // /account/payments e o dinheiro do PROFESSOR (a pagina inteira exige
  // teacherStudio.access). Para quem tambem e admin, a regra abaixo devolvia
  // "ops" — e como o item Earnings so existe no contexto teacher, a barra
  // escondia justamente a pagina em que a pessoa estava.
  if (
    pathname.startsWith("/account/payments")
    && hasPermission(subject, "teacherStudio.access")
  ) {
    return "teacher";
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
  collapsed = false,
  count,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
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
      // Recolhida, o rótulo sai da linha mas fica no DOM: é o nome do link
      // para o leitor de tela, e o CSS o mostra como dica no hover E no foco
      // do teclado (o title só aparecia no mouse, e depois de 1s).
      className={`platform-nav-link group relative flex h-11 min-h-11 shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold transition-colors ${
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
            className={`shrink-0 rounded-sm bg-[var(--color-surface-soft)] px-1 text-center font-semibold tabular-nums text-[var(--color-ink)] ${
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
    </Link>
  );
}
