"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  BarChart3,
  Bookmark,
  BookOpen,
  Calendar,
  CreditCard,
  ExternalLink,
  GraduationCap,
  Image,
  LayoutDashboard,
  MessageCircle,
  PenTool,
  Plug,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShoppingBag,
  Tag,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  platformNav,
  type PlatformNavContext,
} from "@/data/site";
import {
  hasPermission,
  type PermissionSubject,
} from "@/lib/permissions";

const iconMap: Record<string, LucideIcon> = {
  Award,
  BarChart3,
  Bookmark,
  BookOpen,
  Calendar,
  CreditCard,
  GraduationCap,
  Image,
  LayoutDashboard,
  MessageCircle,
  PenTool,
  Plug,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShoppingBag,
  Tag,
  UserCheck,
  Users,
  Wallet,
};

// Hotmart producer IA (macro groups) adapted to Skillset labels:
// Products / Sales / Finance / Reports / Partnerships / Setup.
// Learner + shared sections stay first/last.
const sectionOrder = [
  "Discover",
  "Learn",
  "My Learning",
  "Products",
  "Sales",
  "Finance",
  "Reports",
  "Partnerships",
  "Setup",
  "Operations",
  "Account",
];

export function PlatformNav({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const subject: PermissionSubject = { roles: user?.roles ?? ["guest"] };
  const context = resolveContext(pathname, subject);

  const visibleItems = platformNav
    .filter(
      (item) =>
        item.contexts.includes(context) &&
        (!item.permission || hasPermission(subject, item.permission)),
    )
    .sort((a, b) => {
      const sectionDelta =
        getSectionRank(a.section) - getSectionRank(b.section);

      if (sectionDelta !== 0) {
        return sectionDelta;
      }

      return platformNav.indexOf(a) - platformNav.indexOf(b);
    });

  return (
    <nav
      className="platform-sidebar-nav mt-3 flex flex-col gap-1.5"
      aria-label={t("platform.sidebarNavLabel")}
    >
      {visibleItems.map((item, index) => {
        const showSection =
          !collapsed && item.section !== visibleItems[index - 1]?.section;

        return (
          <Fragment key={item.href}>
            {showSection ? (
              <p className="platform-sidebar-section-label shrink-0">
                {item.section}
              </p>
            ) : null}
            <PlatformNavLink
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={isActivePlatformRoute(pathname, item.href)}
              collapsed={collapsed}
              newTab={item.newTab}
            />
          </Fragment>
        );
      })}
    </nav>
  );
}

function getSectionRank(section: string) {
  const index = sectionOrder.indexOf(section);
  return index === -1 ? sectionOrder.length : index;
}

function resolveContext(
  pathname: string,
  subject: PermissionSubject,
): PlatformNavContext {
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
  collapsed,
  newTab = false,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  collapsed: boolean;
  newTab?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = iconMap[icon] ?? LayoutDashboard;

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className={`platform-nav-link group relative flex min-h-[50px] shrink-0 items-center gap-2.5 rounded-[10px] border py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(44,82,130,0.24)] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${collapsed ? "justify-center px-0" : "px-2.5"} ${
        active
          ? "platform-nav-active border-[rgba(24,58,94,0.2)] shadow-[0_10px_22px_rgba(26,54,93,0.16)]"
          : "border-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]"
      }`}
    >
      <span className="platform-nav-icon-chip">
        <Icon
          aria-hidden="true"
          size={18}
          strokeWidth={2}
          className="shrink-0"
        />
      </span>
      <span className="platform-sidebar-label">{label}</span>
      {newTab && !collapsed ? (
        <ExternalLink
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
          className="ml-auto shrink-0 text-[var(--color-ink-muted)] transition-colors group-hover:text-[var(--color-ink-soft)]"
        />
      ) : null}
      {newTab ? (
        <span className="sr-only">{t("platform.opensInNewTab")}</span>
      ) : null}
    </Link>
  );
}
