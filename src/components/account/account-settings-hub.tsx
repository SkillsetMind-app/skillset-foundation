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
import { useEffect, useId, useState } from "react";

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

  // Sem cartão de abertura: o título curto ("Settings" + uma linha) vem do
  // PlatformShell, como nas outras telas. O cartão com faixa dourada e brilho
  // vermelho, mais uma manchete em serifa por aba, empurrava os ajustes para
  // baixo da primeira tela no celular.
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

// O retorno do salvar mora na linha que mudou: "Saved" por 2s, ou o erro logo
// embaixo da chave. Antes o sucesso não dizia nada e a falha era uma linha
// vermelha no topo do cartão, longe do dedo que tocou.
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

function NotificationPreferencesPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useRowStatus();

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

      <div className="mt-4 divide-y divide-[var(--color-line)]">
        {notificationRows.map((key) => (
          <ToggleRow
            key={key}
            label={t(`accountSettings.notifications.${key}.label`)}
            description={t(`accountSettings.notifications.${key}.description`)}
            checked={prefs[key]}
            disabled={!loaded}
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
  const [prefs, setPrefs] = useState<LearningPreferences>(
    defaultLearningPreferences,
  );
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useRowStatus();

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

      <div className="mt-4 divide-y divide-[var(--color-line)]">
        {learningRows.map((key) => (
          <ToggleRow
            key={key}
            label={t(`accountSettings.learning.${key}.label`)}
            description={t(`accountSettings.learning.${key}.description`)}
            checked={prefs[key]}
            disabled={!loaded}
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
  disabled = false,
  label,
  onChange,
  saved,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: () => void;
  /** true = acabou de salvar; false = falhou; undefined = nada a dizer. */
  saved?: boolean;
}) {
  const { t } = useTranslation();
  // Nome = só o rótulo; a descrição entra como descrição. Com aria-label o
  // leitor de tela nunca lia o que cada chave faz.
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="py-1">
      {/* A linha inteira é a chave. Antes só o trilho de 46×26 respondia ao
          toque e o texto ao lado não era clicável. As margens negativas
          alinham o texto ao título e deixam o fundo do hover respirar. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={onChange}
        className="-mx-3 flex min-h-11 w-[calc(100%_+_1.5rem)] items-center justify-between gap-4 rounded-md px-3 py-3 text-left hover:bg-[var(--color-surface-soft)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>
          <span id={labelId} className="block text-sm font-bold text-[var(--color-ink)]">
            {label}
          </span>
          <span id={descriptionId} className="mt-1 block max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {description}
          </span>
        </span>
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
