"use client";

import {
  Award,
  Bookmark,
  ChevronDown,
  ExternalLink,
  FileText,
  GraduationCap,
  Heart,
  LayoutDashboard,
  LogOut,
  Presentation,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { planById, type PlanId } from "@/data/plans";
import { primaryRoleKey, type SkillsetUser } from "@/domain/auth";
import { getPrimaryWorkspaceHref } from "@/lib/auth/routing";
import { hasPermission } from "@/lib/permissions";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

type AccountMenuProps = {
  user: SkillsetUser;
  onSignOut: () => Promise<void>;
};

function useDismissableLayer(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onDismiss, ref]);
}

export function AccountMenu({ onSignOut, user }: AccountMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPlanId, setCurrentPlanId] = useState<PlanId>("free");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? "";
  const moneyHref = user.roles.includes("teacher")
    ? "/account/payments"
    : "/account/billing";
  const moneyLabel = user.roles.includes("teacher")
    ? t("account.payoutsTax")
    : t("account.billing");
  const currentPlanName = planById(currentPlanId).name;
  const accountRoleLabel = t(primaryRoleKey(user.roles));
  const memberFallback = t("account.memberFallback");
  // One account, several workspaces. Everyone signed in has the classroom; a
  // teacher also has the studio; an admin also has operations. The menu lists
  // every workspace this account can actually enter and hides the one it is
  // already in, so it reads as a toggle rather than a pile of links.
  //
  // This is NOT the admin preview in /ops. That one only narrows what the
  // interface offers, to answer "what does a learner see". This switches
  // between workspaces the account genuinely holds, so the person can do the
  // work, not just look at it.
  //
  // Staff used to be excluded outright, which is why the founder — admin and
  // teacher on the same account — never saw a way to reach his own studio.
  const workspaces = [
    { href: "/learn", label: t("account.studentView"), icon: GraduationCap },
    ...(user.roles.includes("teacher")
      ? [{ href: "/teach", label: t("account.teacherView"), icon: Presentation }]
      : []),
    ...(hasPermission({ roles: user.roles }, "platform.accessAdmin")
      ? [{ href: "/ops", label: t("account.opsView"), icon: ShieldCheck }]
      : []),
  ];
  const otherWorkspaces = workspaces.filter(
    (workspace) =>
      pathname !== workspace.href && !pathname.startsWith(`${workspace.href}/`),
  );

  // Someone with no studio yet gets the application instead. That one still
  // opens in a new tab: it is a side trip through the onboarding quiz, not a
  // switch between places the account already lives.
  const becomeTeacher = user.roles.includes("teacher")
    ? null
    : {
        href: "/onboarding?path=teacher",
        label: t("account.becomeTeacher"),
        icon: Presentation,
      };

  useDismissableLayer(wrapperRef, isOpen, () => setIsOpen(false));

  useEffect(() => {
    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setCurrentPlanId(profile?.currentPlanId ?? "free");
      },
      () => {
        setCurrentPlanId("free");
      },
    );
  }, [user.uid]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="account-menu-panel"
        aria-label={t("account.openMenu")}
        className="account-menu-trigger"
        onClick={() => setIsOpen((current) => !current)}
      >
        <UserAvatar
          name={user.displayName || user.email}
          photoURL={user.photoURL}
          size="sm"
        />
        <span className="account-menu-trigger__who">
          <span className="account-menu-trigger__name">
            {user.displayName || user.email || memberFallback}
          </span>
          <span className="account-menu-trigger__role">
            {accountRoleLabel}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          size={12}
          strokeWidth={1.8}
          className={isOpen ? "rotate-180 transition-transform duration-200" : "transition-transform duration-200"}
        />
      </button>

      {isOpen ? (
        <div id="account-menu-panel" className="account-menu-panel">
          <div className="account-menu-head">
            <UserAvatar
              name={user.displayName || user.email}
              photoURL={user.photoURL}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--color-ink)]">
                {user.displayName || memberFallback}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--color-ink-soft)]">
                {user.email}
              </p>
              <p className="account-menu-context-chip">{accountRoleLabel}</p>
            </div>
          </div>

          <div className="py-1">
            <MenuLink
              href={getPrimaryWorkspaceHref(user)}
              icon={LayoutDashboard}
              label={t("nav.goToDashboard")}
              onNavigate={() => setIsOpen(false)}
            />
          </div>

          {otherWorkspaces.length > 0 || becomeTeacher ? (
            <>
              <div className="account-menu-separator" />
              <div className="py-1">
                <p className="account-menu-section-label">
                  {t("account.switchView")}
                </p>
                {otherWorkspaces.map((workspace) => (
                  <MenuLink
                    key={workspace.href}
                    href={workspace.href}
                    icon={workspace.icon}
                    label={workspace.label}
                    onNavigate={() => setIsOpen(false)}
                  />
                ))}
                {becomeTeacher ? (
                  <RoleSwitchItem
                    href={becomeTeacher.href}
                    icon={becomeTeacher.icon}
                    label={becomeTeacher.label}
                    onNavigate={() => setIsOpen(false)}
                  />
                ) : null}
              </div>
            </>
          ) : null}

          <div className="account-menu-separator" />

          <div className="py-1">
            <p className="account-menu-section-label">
              {t("account.sectionAccount")}
            </p>
            <MenuLink
              href="/account/plans"
              icon={Award}
              label={
                user.roles.includes("teacher")
                  ? t("account.creatorPlan")
                  : t("account.subscription")
              }
              chip={currentPlanName}
              onNavigate={() => setIsOpen(false)}
            />
            <MenuLink
              href="/account"
              icon={Settings}
              label={t("account.settings")}
              onNavigate={() => setIsOpen(false)}
            />
            <MenuLink
              href={moneyHref}
              icon={FileText}
              label={moneyLabel}
              onNavigate={() => setIsOpen(false)}
            />
            <MenuLink
              href="/learn/credentials"
              icon={Bookmark}
              label={t("account.myCredentials")}
              onNavigate={() => setIsOpen(false)}
            />
            {!user.roles.includes("teacher") ? (
              <MenuLink
                href="/learn/wishlist"
                icon={Heart}
                label={t("account.wishlist")}
                onNavigate={() => setIsOpen(false)}
              />
            ) : null}
          </div>

          <div className="account-menu-separator" />
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              void onSignOut();
            }}
            className="account-menu-item account-menu-item--danger"
          >
            <span className="account-menu-icon account-menu-icon--danger">
              <LogOut aria-hidden="true" size={14} strokeWidth={1.8} />
            </span>
            {t("account.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  chip,
  href,
  icon: Icon,
  label,
  onNavigate,
}: {
  chip?: string;
  href: string;
  icon: LucideIcon;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} className="account-menu-item" onClick={onNavigate}>
      <span className="account-menu-icon">
        <Icon aria-hidden="true" size={14} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chip ? <span className="account-menu-chip">{chip}</span> : null}
    </Link>
  );
}

function RoleSwitchItem({
  href,
  icon: Icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} ${t("account.opensNewTab")}`}
      className="account-menu-item"
      onClick={onNavigate}
    >
      <span className="account-menu-icon">
        <Icon aria-hidden="true" size={14} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ExternalLink
        aria-hidden="true"
        size={13}
        strokeWidth={1.9}
        className="shrink-0 text-[var(--color-ink-muted)]"
      />
    </Link>
  );
}
