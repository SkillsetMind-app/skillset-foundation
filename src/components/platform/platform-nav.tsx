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

// Keys of `platform.navSection.*`; the visible label comes from the dictionary.
// Teacher: eight top-level items (Home, Products, Students, Inbox, Sales,
// Earnings, Promote, Help). Learner: four fixed items and Help; at the bottom,
// purchases and settings. "help" is not a section of items: it marks where the
// Help button goes in the list.
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
  // Footer — see `footerSections`.
  "discover",
];

// Sections that do NOT become an accordion: each item becomes a direct row of
// the bar. Only Sales (sales, subscriptions, reports) and Promote (marketing,
// storefront, media) stay grouped: they are what people check once in a while,
// and that way the top level fits in eight items.
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

// Discovery is not the work of producing or studying: it goes at the bottom of
// the bar, separated by a line. Switching between learner and teacher is the
// button at the top, not a link here.
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
  /** The ☰ button points to this list (aria-controls). */
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
  // This used to hold ONE section: opening a group closed all the others.
  // Measured on /teach, with 6 groups: there were never more than 7 to 9 visible
  // links, so the creator never saw the product map: they had to open, memorize
  // and close. That is how /teach/media and /teach/sales ended up with no path
  // at all from the initial state. Now the set is open, and opening one group
  // does not cost closing another.
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
  // Default: the group of the current route open (or the first one), as before.
  // The difference is that from there the user accumulates open groups.
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
  // Help comes right after the day's work (Promote / the learner's fixed items)
  // and before purchases and settings. It is the ONLY Help on the screen (neither
  // the top bar nor the avatar menu repeat it). The operations staff has no Help:
  // the choices talk to learners and teachers, not to support.
  const helpRank = getSectionRank("help");
  const beforeHelp = mainGroups.filter((group) => getSectionRank(group.section) < helpRank);
  const afterHelp = mainGroups.filter((group) => getSectionRank(group.section) > helpRank);
  const help = context === "ops" ? null : (
    <div className="platform-nav-section shrink-0" key="help">
      <HelpMenu
        variant="nav"
        side={context === "teacher" ? "teacher" : "student"}
        collapsed={collapsed}
        // Collapsed, Help does not open in place (it opens the bar or the drawer),
        // like the groups: it does not say "expanded" after the drawer closes.
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
    // The groups came out in raw English ("Products", "Sales") in every language,
    // and the collapsed icon's tooltip was also assembled by hand in English.
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
          // Same 44px row, 14px and 32px chip as the direct links: Sales and
          // Promote looked like section titles (38px, 11.5px in UPPERCASE) and,
          // in the phone drawer, ended up at 30px with the border in the text color.
          className={`platform-nav-link platform-nav-section-trigger group relative flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 rounded-md border border-transparent py-1.5 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)] ${
            collapsed ? "justify-center px-0" : "px-2.5"
          } ${
            collapsed && isActiveSection
              ? "platform-nav-active"
              : isActiveSection
                ? "platform-nav-section-active"
                : ""
          }`}
        >
          {/* Collapsed, the item is the only square: no icon chip
              (it was the second layer on hover; see the "Collapsed rail" block
              in globals.css). The label below becomes the tooltip on hover and
              on keyboard focus. */}
          {collapsed ? (
            <SectionIcon aria-hidden="true" size={18} strokeWidth={2} />
          ) : (
            <span className="platform-nav-icon-chip">
              <SectionIcon aria-hidden="true" size={18} strokeWidth={2} />
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

  // /account/payments is the TEACHER's money (the whole page requires
  // teacherStudio.access). For someone who is also an admin, the rule below returned
  // "ops" — and since the Earnings item only exists in the teacher context, the bar
  // hid exactly the page the person was on.
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
      // Collapsed, the label leaves the row but stays in the DOM: it is the link name
      // for the screen reader, and the CSS shows it as a tooltip on hover AND on keyboard
      // focus (the title only appeared on mouse, and after 1s).
      className={`platform-nav-link group relative flex h-11 min-h-11 shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold transition-colors ${
        // Phone drawer: the current page gets the stronger background, navy
        // text and the gold thread, in both themes (the old light background
        // was weaker than the hover and, in dark, disappeared into the drawer
        // background). On desktop the dark bar block (.platform-sidebar)
        // overrides these classes with !important and draws the same thread.
        active
          ? "platform-nav-active border-[rgba(24,58,94,0.2)] bg-[var(--color-surface-strong)] text-[var(--color-primary)] before:absolute before:left-1 before:top-1/2 before:h-[18px] before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--color-accent)] before:content-['']"
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
      {/* The exact count lives inside the label: with the bar open it is only
          for the screen reader (the badge shows the number); collapsed, the tooltip
          shows "128 pending" even when the badge says "99+". */}
      <span className="platform-sidebar-label min-w-0 truncate">
        {label}
        {countLabel !== undefined ? <span className="platform-sidebar-label-count">, {countLabel}</span> : null}
      </span>
      {count !== undefined ? (
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
      ) : null}
    </Link>
  );
}
