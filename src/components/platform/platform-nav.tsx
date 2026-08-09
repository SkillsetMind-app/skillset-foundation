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

const sectionOrder = [
  "Home",
  "Products",
  "Marketing",
  "Sales",
  "Earnings",
  "Reports",
  "Growth",
  "Tools",
  "My Learning",
  "Discover",
  "Learn",
  "Operations",
  "Account",
];

const directSections = new Set(["Home", "Earnings", "My Learning", "Discover"]);

const sectionIconMap: Record<string, LucideIcon> = {
  Discover: ShoppingBag,
  Home: House,
  Learn: GraduationCap,
  "My Learning": BookOpen,
  Products: PackageOpen,
  Marketing: Megaphone,
  Sales: Receipt,
  Earnings: TrendingUp,
  Reports: BarChart3,
  Growth: Users,
  Tools: Settings,
  Operations: UserCheck,
  Account: Settings,
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
  const [sectionChoice, setSectionChoice] = useState<{
    pathname: string;
    section: string | null;
  }>({ pathname: "", section: null });
  const subject: PermissionSubject = { roles: user?.roles ?? ["guest"] };
  const context = resolveContext(pathname, subject);

  const visibleItems = platformNav
    .filter(
      (item) =>
        item.contexts.includes(context) &&
        (!item.permission || hasPermission(subject, item.permission))
    )
    .sort((a, b) => {
      const sectionDelta = getSectionRank(a.section) - getSectionRank(b.section);

      if (sectionDelta !== 0) {
        return sectionDelta;
      }

      return platformNav.indexOf(a) - platformNav.indexOf(b);
    });

  const groups: Array<{ section: string; items: typeof visibleItems }> = [];
  for (const item of visibleItems) {
    const currentGroup = groups.at(-1);
    if (!currentGroup || currentGroup.section !== item.section) {
      groups.push({ section: item.section, items: [item] });
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
  const expandedSection =
    sectionChoice.pathname === pathname
      ? sectionChoice.section
      : (activeAccordionSection ?? firstAccordionSection ?? null);

  function toggleSection(section: string) {
    if (collapsed) {
      setSectionChoice({ pathname, section });
      onRequestExpand?.();
      return;
    }

    setSectionChoice({
      pathname,
      section: expandedSection === section ? null : section,
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
              />
            </div>
          );
        }

        const SectionIcon = sectionIconMap[group.section] ?? LayoutDashboard;
        const isActiveSection = group.section === activeSection;
        const isExpanded = !collapsed && expandedSection === group.section;
        const panelId = `${panelIdPrefix}-${group.section.toLowerCase().replace(/\s+/g, "-")}`;

        return (
          <div className="platform-nav-section shrink-0" key={group.section}>
            <button
              type="button"
              onClick={() => toggleSection(group.section)}
              aria-controls={collapsed ? undefined : panelId}
              aria-expanded={collapsed ? undefined : isExpanded}
              aria-label={collapsed ? `Open ${group.section} navigation` : undefined}
              title={collapsed ? group.section : undefined}
              className={`platform-nav-link platform-nav-section-trigger group relative flex w-full shrink-0 items-center rounded-[10px] border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(44,82,130,0.24)] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                collapsed ? "justify-center px-0" : "px-2"
              } ${
                collapsed && isActiveSection
                  ? "platform-nav-active"
                  : isActiveSection
                    ? "platform-nav-section-active"
                    : ""
              }`}
            >
              <span className="platform-nav-icon-chip">
                <SectionIcon aria-hidden="true" size={17} strokeWidth={2} />
              </span>
              <span className="platform-sidebar-label min-w-0 truncate">{group.section}</span>
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
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  newTab?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = iconMap[icon] ?? LayoutDashboard;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className={`platform-nav-link group relative flex h-11 min-h-11 shrink-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(44,82,130,0.24)] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        active
          ? "platform-nav-active border-[rgba(24,58,94,0.2)] shadow-[0_10px_22px_rgba(26,54,93,0.16)]"
          : "border-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]"
      }`}
    >
      <span className="platform-nav-icon-chip">
        <Icon aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
      </span>
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
