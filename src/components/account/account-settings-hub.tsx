"use client";

import {
  Bell,
  BookOpen,
  Database,
  Shield,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountDataPanel } from "@/components/account/account-data-panel";
import { ProfileSettingsPanel } from "@/components/account/profile-settings-panel";
import { SecuritySettingsPanel } from "@/components/account/security-settings-panel";
import { useAuth } from "@/components/auth/auth-provider";
import {
  defaultLearningPreferences,
  defaultNotificationPreferences,
  type LearningPreferences,
  type NotificationPreferences,
} from "@/domain/user-profile";
import {
  subscribeToUserProfile,
  updateUserPreferences,
} from "@/lib/data/user-profiles";

type SettingsTab =
  | "profile"
  | "notifications"
  | "security"
  | "learning"
  | "privacy";

const tabs: Array<{
  value: SettingsTab;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "profile",
    label: "Profile",
    description: "Name, photo, username, bio, phone, timezone.",
    icon: UserRound,
  },
  {
    value: "notifications",
    label: "Notifications",
    description: "Course, billing, and support alerts.",
    icon: Bell,
  },
  {
    value: "security",
    label: "Security",
    description: "Login email, password, recovery, and sensitive access.",
    icon: Shield,
  },
  {
    value: "learning",
    label: "Learning",
    description: "Playback, captions, digest, and classroom defaults.",
    icon: BookOpen,
  },
  {
    value: "privacy",
    label: "Privacy & data",
    description: "Export data or request account deletion.",
    icon: Database,
  },
];

export function AccountSettingsHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = isSettingsTab(requestedTab) ? requestedTab : "profile";

  function selectTab(nextTab: SettingsTab) {
    router.replace(`/account?tab=${nextTab}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <header className="platform-hero-card rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Settings
        </p>
        <h1 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] lg:text-5xl">
          Your SkillsetMind preferences.
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Profile, login email, password, alerts, learning defaults, and privacy
          controls live here. Billing and creator payouts stay in their own
          money sections.
        </p>
      </header>

      <div className="account-settings-grid">
        <nav className="account-settings-tabs" aria-label="Settings sections">
          {tabs.map((tab) => (
            <SettingsTabButton
              key={tab.value}
              active={activeTab === tab.value}
              icon={tab.icon}
              label={tab.label}
              description={tab.description}
              onClick={() => selectTab(tab.value)}
            />
          ))}
        </nav>

        <div className="min-w-0 space-y-5">{renderTab(activeTab)}</div>
      </div>
    </div>
  );
}

function renderTab(tab: SettingsTab) {
  if (tab === "profile") {
    return <ProfileSettingsPanel />;
  }

  if (tab === "notifications") {
    return <NotificationPreferencesPanel />;
  }

  if (tab === "security") {
    return <SecuritySettingsPanel />;
  }

  if (tab === "learning") {
    return <LearningPreferencesPanel />;
  }

  return <AccountDataPanel />;
}

function SettingsTabButton({
  active,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`account-settings-tab ${active ? "account-settings-tab--active" : ""}`}
    >
      <span className="account-settings-tab__icon">
        <Icon aria-hidden="true" size={16} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className="mt-1 block text-left text-[11px] font-medium leading-4">
          {description}
        </span>
      </span>
    </button>
  );
}

function NotificationPreferencesPanel() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [loaded, setLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPrefs({
          ...defaultNotificationPreferences,
          ...(profile?.preferences?.notifications ?? {}),
        });
        setLoaded(true);
      },
      // Couldn't load saved preferences: keep defaults but let the user act.
      () => setLoaded(true),
    );
  }, [user]);

  function toggle(key: keyof NotificationPreferences) {
    if (!user) {
      return;
    }

    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaveFailed(false);
    updateUserPreferences(user.uid, { notifications: next }).catch(() => {
      // Roll back the optimistic flip so the UI never claims a save that
      // did not land.
      setPrefs(previous);
      setSaveFailed(true);
    });
  }

  return (
    <section className="settings-section-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Notifications
      </p>
      <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        Decide what gets your attention.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Saved to your account and applied as each channel ships. Transactional
        security and payment emails stay enabled for account safety.
      </p>

      {saveFailed ? (
        <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          We could not save that change. Check your connection and try again.
        </p>
      ) : null}

      <div className="mt-6 divide-y divide-[var(--color-line)]">
        <ToggleRow
          label="Product emails"
          description="Important product updates and weekly summaries."
          checked={prefs.productEmails}
          disabled={!loaded}
          onChange={() => toggle("productEmails")}
        />
        <ToggleRow
          label="Course activity"
          description="Course reviews, comments, lesson activity, and student milestones."
          checked={prefs.courseActivity}
          disabled={!loaded}
          onChange={() => toggle("courseActivity")}
        />
        <ToggleRow
          label="Billing and payout alerts"
          description="Receipts, invoices, earnings, refund, and failed payment notices."
          checked={prefs.billingAlerts}
          disabled={!loaded}
          onChange={() => toggle("billingAlerts")}
        />
        <ToggleRow
          label="Marketing emails"
          description="Launch announcements, promotions, and editorial campaigns."
          checked={prefs.marketingEmails}
          disabled={!loaded}
          onChange={() => toggle("marketingEmails")}
        />
      </div>
    </section>
  );
}

function LearningPreferencesPanel() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<LearningPreferences>(
    defaultLearningPreferences,
  );
  const [loaded, setLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPrefs({
          ...defaultLearningPreferences,
          ...(profile?.preferences?.learning ?? {}),
        });
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, [user]);

  function toggle(key: keyof LearningPreferences) {
    if (!user) {
      return;
    }

    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaveFailed(false);
    updateUserPreferences(user.uid, { learning: next }).catch(() => {
      setPrefs(previous);
      setSaveFailed(true);
    });
  }

  return (
    <section className="settings-section-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Learning
      </p>
      <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        Classroom defaults.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Saved to your account so your classroom behaves the same on every
        device. Billing and creator payout setup stay in their own sections.
      </p>

      {saveFailed ? (
        <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          We could not save that change. Check your connection and try again.
        </p>
      ) : null}

      <div className="mt-6 divide-y divide-[var(--color-line)]">
        <ToggleRow
          label="Auto-show captions"
          description="Show captions automatically when a lesson provides them."
          checked={prefs.autoCaptions}
          disabled={!loaded}
          onChange={() => toggle("autoCaptions")}
        />
        <ToggleRow
          label="Daily learning digest"
          description="A lightweight daily reminder for unfinished lessons."
          checked={prefs.dailyDigest}
          disabled={!loaded}
          onChange={() => toggle("dailyDigest")}
        />
      </div>
    </section>
  );
}

function ToggleRow({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <span>
        <span className="block text-sm font-bold text-[var(--color-ink)]">
          {label}
        </span>
        <span className="mt-1 block max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
          {description}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={`settings-toggle ${checked ? "settings-toggle--on" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span />
      </button>
    </div>
  );
}

function isSettingsTab(value: string | null): value is SettingsTab {
  return tabs.some((tab) => tab.value === value);
}
