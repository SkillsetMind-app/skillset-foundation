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
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { planById, type PlanId } from "@/data/plans";
import { formatPrimaryRole, type SkillsetUser } from "@/domain/auth";
import { getPrimaryWorkspaceHref } from "@/lib/auth/routing";
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
  const moneyHref = user.roles.includes("teacher")
    ? "/account/payments"
    : "/account/billing";
  const moneyLabel = user.roles.includes("teacher")
    ? t("account.payoutsTax")
    : t("account.billing");
  const currentPlanName = planById(currentPlanId).name;
  const accountRoleLabel = formatPrimaryRole(user.roles);
  const memberFallback = t("account.memberFallback");
  // One account, both roles: a teacher can drop into their student side; a
  // learner can open the teacher application (the onboarding quiz). The switch
  // opens in a new tab so each side keeps its own context — signalled by the
  // external-link icon on the item.
  const isStaff =
    user.roles.includes("admin") || user.roles.includes("support");
  const roleSwitch = isStaff
    ? null
    : user.roles.includes("teacher")
      ? { href: "/learn", label: t("account.studentView"), icon: GraduationCap }
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
            {formatPrimaryRole(user.roles)}
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

          {roleSwitch ? (
            <>
              <div className="account-menu-separator" />
              <div className="py-1">
                <p className="account-menu-section-label">
                  {t("account.switchView")}
                </p>
                <RoleSwitchItem
                  href={roleSwitch.href}
                  icon={roleSwitch.icon}
                  label={roleSwitch.label}
                  onNavigate={() => setIsOpen(false)}
                />
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
