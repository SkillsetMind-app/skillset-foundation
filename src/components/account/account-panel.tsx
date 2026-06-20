"use client";

import {
  Bell,
  Mail,
  Shield,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const accountLinks = [
  "Profile",
  "Email",
  "Security",
  "Notifications",
] as const;

type AccountLink = (typeof accountLinks)[number];

const accountSections: Array<{
  eyebrow: string;
  description: string;
  links: readonly AccountLink[];
}> = [
  {
    eyebrow: "Settings",
    description: "Profile, login email, password, verification, and alerts.",
    links: ["Profile", "Email", "Security", "Notifications"],
  },
];

const accountLinkMeta: Record<
  AccountLink,
  { href: string; icon: LucideIcon; helper: string }
> = {
  Profile: {
    href: "/account?tab=profile",
    icon: UserRound,
    helper: "Name, username, avatar, bio, phone, timezone.",
  },
  Email: {
    href: "/account?tab=security",
    icon: Mail,
    helper: "Login email, email change, and verification.",
  },
  Security: {
    href: "/account?tab=security",
    icon: Shield,
    helper: "Password, account protection, and data actions.",
  },
  Notifications: {
    href: "/account?tab=notifications",
    icon: Bell,
    helper: "Course, billing, and support alerts.",
  },
};

export function AccountPanel({
  active,
  children,
}: {
  active: AccountLink;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <AccountNavMobile active={active} />
      <aside className="dash-card dash-card--strong hidden h-fit p-4 lg:block">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Settings
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
          Profile, login email, password, verification, and alerts stay here.
          Billing and creator payouts live in their own money sections.
        </p>
        <nav className="mt-5 grid gap-5" aria-label="Account center">
          {accountSections.map((section) => (
            <div key={section.eyebrow}>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                {section.eyebrow}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-ink-soft)]">
                {section.description}
              </p>
              <div className="mt-2 grid gap-1">
                {section.links.map((label) => {
                  const meta = accountLinkMeta[label];

                  return (
                    <AccountNavLink
                      key={meta.href}
                      label={label}
                      href={meta.href}
                      icon={meta.icon}
                      helper={meta.helper}
                      isActive={label === active}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function AccountNavMobile({
  active,
}: {
  active: AccountLink;
}) {
  return (
    <nav
      aria-label="Account center"
      className="dash-card dash-card--strong overflow-x-auto px-2 py-2 lg:hidden"
    >
      <div className="flex min-w-max gap-1">
        {accountLinks.map((label) => {
          const isActive = label === active;
          const meta = accountLinkMeta[label];
          const Icon = meta.icon;

          return (
            <Link
              key={meta.href}
              href={meta.href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[8px] px-3 py-2 text-xs font-semibold transition ${
                isActive
                  ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                  : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
              }`}
            >
              <Icon aria-hidden="true" size={14} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function AccountNavLink({
  label,
  href,
  icon: Icon,
  helper,
  isActive,
}: {
  label: AccountLink;
  href: string;
  icon: LucideIcon;
  helper: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-start gap-3 rounded-[10px] px-3 py-3 text-sm font-semibold transition ${
        isActive
          ? "account-nav-active bg-[var(--color-primary)] text-[var(--color-base)] shadow-[0_10px_22px_rgba(26,54,93,0.14)]"
          : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
      }`}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-[8px] ${
          isActive
            ? "bg-white text-[var(--color-primary)]"
            : "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
        }`}
      >
        <Icon aria-hidden="true" size={16} strokeWidth={2} />
      </span>
      <span>
        <span className="block">{label}</span>
        <span
          className={`account-nav-helper mt-1 block text-[11px] font-medium leading-4 ${
            isActive
              ? "text-[rgba(255,255,255,0.78)]"
              : "text-[var(--color-ink-muted)]"
          }`}
        >
          {helper}
        </span>
      </span>
    </Link>
  );
}
