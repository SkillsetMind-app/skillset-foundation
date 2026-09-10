"use client";

import { CircleDollarSign, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformInviteManager } from "@/components/admin/platform-invite-manager";
import { Button, Field, InlineAlert } from "@/components/ui";
import { setActivationWaiver } from "@/lib/data/platform-invites";
import {
  listPlatformUsers,
  setUserRoles,
  type PlatformUser,
} from "@/lib/data/platform-roles";
import {
  allPermissionDefinitions,
  getRolePermissions,
  type Role,
} from "@/lib/permissions";

/**
 * The seven roles and the permission matrix have been in the codebase since the
 * permissions module landed, but nothing could ever assign one — becoming an
 * admin meant editing the table by hand. This is that missing surface.
 *
 * Five levels are offered where the database knows seven. Support, moderation
 * and operations are one "Team" level here because they are the same person
 * today; the three stay separate in the data, so splitting them apart later is
 * a change to this list and nothing else.
 */

type Level = {
  id: string;
  /** A level is ON when every role it maps to is present. */
  roles: readonly Role[];
};

const LEVELS: readonly Level[] = [
  {
    id: "student",
    roles: ["student"],
  },
  {
    id: "teacher",
    roles: ["teacher"],
  },
  {
    id: "staff",
    roles: ["support", "moderator", "ops"],
  },
  {
    id: "admin",
    roles: ["admin"],
  },
];

const copy = "platform.ops.accessPanel";
const refusalKeys = new Map([
  ["Admin privileges are required.", "adminRequired"],
  ["A target user is required.", "targetRequired"],
  ["Roles must be a JSON array.", "invalidRoles"],
  ["Unknown role in the requested set.", "unknownRole"],
  ["That user does not exist.", "userMissing"],
  ["You cannot remove your own admin role.", "selfAdmin"],
  ["The platform must keep at least one administrator.", "lastAdmin"],
]);

function refusalKey(caught: unknown, fallback: "loadError" | "saveError") {
  // RPC errors may be plain objects. Only known public refusals are shown;
  // unknown provider diagnostics never become interface copy.
  const message = typeof caught === "object" && caught !== null && "message" in caught
    ? caught.message
    : undefined;
  return typeof message === "string" ? refusalKeys.get(message) ?? fallback : fallback;
}

function hasLevel(roles: readonly Role[], level: Level): boolean {
  return level.roles.every((role) => roles.includes(role));
}

function toggleLevel(
  roles: readonly Role[],
  level: Level,
  next: boolean,
): Role[] {
  const set = new Set(roles);
  for (const role of level.roles) {
    if (next) {
      set.add(role);
    } else {
      set.delete(role);
    }
  }
  return Array.from(set);
}

function personLabel(user: PlatformUser): string {
  return user.displayName?.trim() || user.email?.trim() || user.uid;
}

export function RoleManager() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"people" | "matrix" | "invitations">("people");
  const [invitationsOpened, setInvitationsOpened] = useState(false);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ scope: "load" | "save"; key: string } | null>(null);
  const [savingUid, setSavingUid] = useState("");
  const [waiverBusy, setWaiverBusy] = useState(false);
  const [waiverFeedback, setWaiverFeedback] = useState<{ uid: string; key: string; failed: boolean } | null>(null);

  async function applyWaiver(user: PlatformUser, waived: boolean) {
    if (waiverBusy || savingUid) return;
    const confirmation = t(`platformInvites.${waived ? "waiveConfirm" : "requireConfirm"}`)
      .replace("{person}", () => personLabel(user));
    if (!window.confirm(confirmation)) return;
    setWaiverBusy(true);
    setWaiverFeedback(null);
    try {
      await setActivationWaiver(user.uid, waived);
      setWaiverFeedback({ uid: user.uid, key: waived ? "waiverSaved" : "requireSaved", failed: false });
    } catch {
      setWaiverFeedback({ uid: user.uid, key: "waiverError", failed: true });
    } finally {
      setWaiverBusy(false);
    }
  }

  const load = useCallback(async (term: string) => {
    setIsLoading(true);
    setError(null);
    try {
      setUsers(await listPlatformUsers(term));
    } catch (caught) {
      setError({ scope: "load", key: refusalKey(caught, "loadError") });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounced so typing a name does not fire one query per keystroke.
    const timer = window.setTimeout(() => void load(search), 300);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  async function applyLevel(user: PlatformUser, level: Level, next: boolean) {
    const nextRoles = toggleLevel(user.roles, level, next);
    setSavingUid(user.uid);
    setError(null);
    try {
      const saved = await setUserRoles(user.uid, nextRoles);
      setUsers((current) =>
        current.map((entry) =>
          entry.uid === user.uid ? { ...entry, roles: saved } : entry,
        ),
      );
    } catch (caught) {
      setError({ scope: "save", key: refusalKey(caught, "saveError") });
    } finally {
      setSavingUid("");
    }
  }

  // One permission set per level, built once: the matrix is levels x
  // permissions, so an includes() inside both loops would be a linear scan
  // per cell. Set<string> also sidesteps the widened key type that
  // allPermissionDefinitions exposes.
  const levelPermissions = LEVELS.map(
    (level) =>
      new Set<string>(
        level.roles.flatMap((role) => [...getRolePermissions(role)]),
      ),
  );

  const tabs = [
    { id: "people" as const, label: t(`${copy}.people`) },
    { id: "invitations" as const, label: t("platformInvites.tab") },
    { id: "matrix" as const, label: t(`${copy}.matrix`) },
  ];

  return (
    <section className="min-w-0 rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setTab(entry.id);
              if (entry.id === "invitations") setInvitationsOpened(true);
            }}
            aria-pressed={tab === entry.id}
            className={`min-h-11 rounded-[10px] px-4 py-2 text-sm font-bold transition ${
              tab === entry.id
                ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                : "border border-[var(--color-line)] text-[var(--color-ink-soft)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {invitationsOpened ? <div hidden={tab !== "invitations"} className="mt-6 min-w-0"><PlatformInviteManager /></div> : null}

      {tab === "people" && error ? (
        <InlineAlert tone="error" className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span>{t(`${copy}.errors.${error.key}`)}</span>
          {error.scope === "load" ? (
            <Button variant="outline" className="min-h-11" onClick={() => void load(search)}>
              <RotateCcw size={16} aria-hidden />
              {t("authFlow.loading.retry")}
            </Button>
          ) : null}
        </InlineAlert>
      ) : null}

      {tab === "people" ? (
        <div className="mt-6">
          <Field id="ops-role-search" label={t(`${copy}.searchLabel`)}>
            {a11y => <input
              {...a11y}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(`${copy}.searchPlaceholder`)}
              className="min-h-11 w-full rounded-[10px] border border-[var(--color-line)] px-4 py-2.5 text-sm font-normal"
            />}
          </Field>

          {isLoading ? (
            <p role="status" className="mt-6 text-sm text-[var(--color-ink-soft)]">
              {t(`${copy}.loading`)}
            </p>
          ) : users.length === 0 ? (
            error?.scope === "load" ? null : <p className="mt-6 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
          ) : (
            <ul className="mt-6 space-y-3">
              {users.map((user) => (
                <li
                  key={user.uid}
                  className="rounded-[12px] border border-[var(--color-line)] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-bold text-[var(--color-ink)]">
                      {personLabel(user)}
                    </p>
                    {user.email ? (
                      <p className="min-w-0 break-all text-xs text-[var(--color-ink-soft)]">
                        {user.email}
                      </p>
                    ) : null}
                  </div>

                  {user.roles.length === 0 ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {t(`${copy}.noLevel`)}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-4">
                    {LEVELS.map((level) => (
                      <label
                        key={level.id}
                        title={t(`${copy}.levels.${level.id}.description`)}
                        className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--color-ink)]"
                      >
                        <input
                          type="checkbox"
                          checked={hasLevel(user.roles, level)}
                          disabled={savingUid === user.uid || waiverBusy}
                          onChange={(event) =>
                            void applyLevel(user, level, event.target.checked)
                          }
                        />
                        {t(`${copy}.levels.${level.id}.label`)}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" disabled={waiverBusy || Boolean(savingUid)} className="min-h-11 max-w-full whitespace-normal" onClick={() => void applyWaiver(user, true)}>
                      <CircleDollarSign size={16} className="shrink-0" aria-hidden />{t("platformInvites.waive")}
                    </Button>
                    <Button variant="outline" disabled={waiverBusy || Boolean(savingUid)} className="min-h-11 max-w-full whitespace-normal" onClick={() => void applyWaiver(user, false)}>
                      <CircleDollarSign size={16} className="shrink-0" aria-hidden />{t("platformInvites.require")}
                    </Button>
                  </div>
                  {waiverFeedback?.uid === user.uid ? <InlineAlert tone={waiverFeedback.failed ? "error" : "success"} className="mt-3">{t(`platformInvites.${waiverFeedback.key}`)}</InlineAlert> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === "matrix" ? (
        <div role="region" aria-label={t(`${copy}.matrix`)} tabIndex={0} className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--color-line)] py-2 pr-4 font-bold">
                  {t(`${copy}.canDo`)}
                </th>
                {LEVELS.map((level) => (
                  <th
                    key={level.id}
                    className="border-b border-[var(--color-line)] py-2 pr-4 font-bold"
                  >
                    {t(`${copy}.levels.${level.id}.label`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPermissionDefinitions.map((definition) => (
                <tr key={definition.key}>
                  <td
                    className="border-b border-[var(--color-line)] py-2 pr-4 text-[var(--color-ink-soft)]"
                    title={t(`${copy}.permissions.${definition.key}.description`)}
                  >
                    {t(`${copy}.permissions.${definition.key}.label`)}
                  </td>
                  {LEVELS.map((level, levelIndex) => {
                    // A level grants a permission when ANY role behind it does.
                    // The union is what "Team" means.
                    const allowed = levelPermissions[levelIndex].has(
                      definition.key,
                    );
                    return (
                      <td
                        key={level.id}
                        className="border-b border-[var(--color-line)] py-2 pr-4"
                      >
                        <span aria-label={t(`${copy}.${allowed ? "yes" : "no"}`)}>
                          {allowed ? "✓" : "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
