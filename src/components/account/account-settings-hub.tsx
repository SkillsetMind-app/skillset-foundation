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
import { useEffect, useId, useRef, useState } from "react";

import { AccountDataPanel } from "@/components/account/account-data-panel";
import { ProfileSettingsPanel } from "@/components/account/profile-settings-panel";
import { SecuritySettingsPanel } from "@/components/account/security-settings-panel";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  defaultLearningPreferences,
  defaultNotificationPreferences,
  type LearningPreferences,
  type NotificationPreferences,
  type UserProfile,
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
  icon: LucideIcon;
}> = [
  {
    value: "profile",
    icon: UserRound,
  },
  {
    value: "notifications",
    icon: Bell,
  },
  {
    value: "security",
    icon: Shield,
  },
  {
    value: "learning",
    icon: BookOpen,
  },
  {
    value: "privacy",
    icon: Database,
  },
];

export function AccountSettingsHub() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = isSettingsTab(requestedTab) ? requestedTab : "profile";

  function selectTab(nextTab: SettingsTab) {
    router.replace(`/account?tab=${nextTab}`, { scroll: false });
  }

  // No opening card: the short title ("Settings" + one line) comes from the
  // PlatformShell, as on the other screens. The card with a gold stripe and red
  // glow, plus a serif headline per tab, pushed the settings below the first
  // screen on a phone.
  return (
    <div className="space-y-6">
      <div className="account-settings-grid">
        <nav className="account-settings-tabs" aria-label={t("accountSettings.navigation")}>
          {tabs.map((tab) => (
            <SettingsTabButton
              key={tab.value}
              active={activeTab === tab.value}
              icon={tab.icon}
              label={t(`accountSettings.tabs.${tab.value}.label`)}
              description={t(`accountSettings.tabs.${tab.value}.description`)}
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
        <span className="account-settings-tab__description mt-1 block text-left text-[11px] font-medium leading-4">
          {description}
        </span>
      </span>
    </button>
  );
}

const notificationRows = [
  "productEmails",
  "courseActivity",
  "billingAlerts",
  "marketingEmails",
  "emailDigest",
] as const satisfies ReadonlyArray<keyof NotificationPreferences>;

const learningRows = [
  "autoCaptions",
  "dailyDigest",
] as const satisfies ReadonlyArray<keyof LearningPreferences>;

// The result of saving lives on the row that changed: "Saved" for 2s, or the error right
// under the switch. Before, success said nothing and failure was a single red
// line at the top of the card, far from the finger that tapped.
type RowStatus = { row: string; saved: boolean } | null;

function useRowStatus() {
  const [status, setStatus] = useState<RowStatus>(null);
  useEffect(() => {
    if (!status?.saved) return;
    const timer = window.setTimeout(() => setStatus(null), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return [status, setStatus] as const;
}

// The person's saved choice. `null` until it arrives: the switches show no
// position at all (before, they showed the default and jumped to the saved one). If the
// read fails they stay locked, with the error and "Try again": before, they stayed
// free showing the default, and one tap wrote the default over the saved value.
function useSavedPreferences<T>(read: (profile: UserProfile | null) => T) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPrefs(read(profile));
        setFailed(false);
      },
      () => setFailed(true),
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [user, read]);

  // Reads again through the same channel (see subscribeToUserProfile).
  function retry() {
    setFailed(false);
    void subscription.current?.reload();
  }

  return { prefs, setPrefs, loadFailed: failed && prefs === null, retry };
}

const readNotificationPreferences = (profile: UserProfile | null): NotificationPreferences => ({
  ...defaultNotificationPreferences,
  ...(profile?.preferences?.notifications ?? {}),
});

const readLearningPreferences = (profile: UserProfile | null): LearningPreferences => ({
  ...defaultLearningPreferences,
  ...(profile?.preferences?.learning ?? {}),
});

function PreferencesLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 grid gap-3">
      <InlineAlert tone="error">{t("accountSettings.loadError")}</InlineAlert>
      <button type="button" onClick={onRetry} className="button-outline min-h-11 justify-self-start px-4 text-sm">
        {t("appErrors.retry")}
      </button>
    </div>
  );
}

function NotificationPreferencesPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { prefs, setPrefs, loadFailed, retry } = useSavedPreferences(readNotificationPreferences);
  const [status, setStatus] = useRowStatus();

  function toggle(key: keyof NotificationPreferences) {
    if (!user || !prefs) {
      return;
    }

    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setStatus(null);
    updateUserPreferences(user.uid, { notifications: next }).then(
      () => setStatus({ row: key, saved: true }),
      () => {
        // Roll back the optimistic flip so the UI never claims a save that
        // did not land.
        setPrefs(previous);
        setStatus({ row: key, saved: false });
      },
    );
  }

  return (
    <section className="settings-section-card">
      <h2 className="text-lg font-bold text-[var(--color-ink)]">
        {t("accountSettings.notifications.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("accountSettings.notifications.description")}
      </p>

      {loadFailed ? <PreferencesLoadError onRetry={retry} /> : null}

      <div aria-busy={!prefs && !loadFailed} className="mt-4 divide-y divide-[var(--color-line)]">
        {notificationRows.map((key) => (
          <ToggleRow
            key={key}
            label={t(`accountSettings.notifications.${key}.label`)}
            description={t(`accountSettings.notifications.${key}.description`)}
            checked={prefs ? prefs[key] : null}
            saved={status?.row === key ? status.saved : undefined}
            onChange={() => toggle(key)}
          />
        ))}
      </div>
    </section>
  );
}

function LearningPreferencesPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { prefs, setPrefs, loadFailed, retry } = useSavedPreferences(readLearningPreferences);
  const [status, setStatus] = useRowStatus();

  function toggle(key: keyof LearningPreferences) {
    if (!user || !prefs) {
      return;
    }

    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setStatus(null);
    updateUserPreferences(user.uid, { learning: next }).then(
      () => setStatus({ row: key, saved: true }),
      () => {
        setPrefs(previous);
        setStatus({ row: key, saved: false });
      },
    );
  }

  return (
    <section className="settings-section-card">
      <h2 className="text-lg font-bold text-[var(--color-ink)]">
        {t("accountSettings.learning.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("accountSettings.learning.description")}
      </p>

      {loadFailed ? <PreferencesLoadError onRetry={retry} /> : null}

      <div aria-busy={!prefs && !loadFailed} className="mt-4 divide-y divide-[var(--color-line)]">
        {learningRows.map((key) => (
          <ToggleRow
            key={key}
            label={t(`accountSettings.learning.${key}.label`)}
            description={t(`accountSettings.learning.${key}.description`)}
            checked={prefs ? prefs[key] : null}
            saved={status?.row === key ? status.saved : undefined}
            onChange={() => toggle(key)}
          />
        ))}
      </div>
    </section>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
  saved,
}: {
  /** null = the saved choice has not arrived yet (or did not load). */
  checked: boolean | null;
  description: string;
  label: string;
  onChange: () => void;
  /** true = just saved; false = failed; undefined = nothing to say. */
  saved?: boolean;
}) {
  const { t } = useTranslation();
  // Name = the label only; the description goes in as the description. With aria-label the
  // screen reader never read what each switch does.
  const labelId = useId();
  const descriptionId = useId();
  const text = (
    <span>
      <span id={labelId} className="block text-sm font-bold text-[var(--color-ink)]">
        {label}
      </span>
      <span id={descriptionId} className="mt-1 block max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {description}
      </span>
    </span>
  );

  // Without the saved choice there is no switch to show: the text and a gray track
  // of the same size, with no position (neither on nor off).
  if (checked === null) {
    return (
      <div className="py-1">
        <div className="-mx-3 flex min-h-11 w-[calc(100%_+_1.5rem)] items-center justify-between gap-4 px-3 py-3">
          {text}
          <span aria-hidden="true" className="h-[26px] w-[46px] shrink-0 rounded-full bg-[var(--color-surface-strong)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="py-1">
      {/* The whole row is the switch. Before, only the 46×26 track responded to
          touch and the text beside it was not clickable. The negative margins
          align the text with the title and give the hover background room to breathe. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onClick={onChange}
        className="-mx-3 flex min-h-11 w-[calc(100%_+_1.5rem)] items-center justify-between gap-4 rounded-md px-3 py-3 text-left hover:bg-[var(--color-surface-soft)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {text}
        <span
          aria-hidden="true"
          className={`settings-toggle ${checked ? "settings-toggle--on" : ""}`}
        >
          <span />
        </span>
      </button>
      {saved === true ? (
        <p role="status" className="motion-rise-in pb-2 text-xs font-semibold text-[var(--color-success-fg)]">
          {t("accountSettings.saved")}
        </p>
      ) : null}
      {saved === false ? (
        <InlineAlert tone="error" className="mb-3">
          {t("accountSettings.saveError")}
        </InlineAlert>
      ) : null}
    </div>
  );
}

function isSettingsTab(value: string | null): value is SettingsTab {
  return tabs.some((tab) => tab.value === value);
}
