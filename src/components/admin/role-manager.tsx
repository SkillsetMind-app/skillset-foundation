"use client";

import { CheckCircle2, CircleDollarSign, RotateCcw, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformInviteManager } from "@/components/admin/platform-invite-manager";
import { AccountControlDialog } from "@/components/admin/account-control-dialog";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import { Button, ConfirmDialog, Field, InlineAlert } from "@/components/ui";
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

// The levels that ask before saving: admin in both directions and Team when
// giving it (I-04: Team opens refunds, moderation and the whole catalog, and it was one
// click). Title, button and sentence of each question.
const LEVEL_QUESTIONS = {
  adminGrant: ["adminGrantTitle", "adminGrantLabel", "confirmAdminGrant"],
  adminRemove: ["adminRemoveTitle", "adminRemoveLabel", "confirmAdminRemove"],
  staffGrant: ["staffGrantTitle", "staffGrantLabel", "confirmStaffGrant"],
} as const;

function levelQuestion(level: Level, next: boolean): keyof typeof LEVEL_QUESTIONS | null {
  if (level.id === "admin") return next ? "adminGrant" : "adminRemove";
  return level.id === "staff" && next ? "staffGrant" : null;
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
  const [accountTarget, setAccountTarget] = useState<PlatformUser | null>(null);
  const [waiverFeedback, setWaiverFeedback] = useState<{ uid: string; key: string; failed: boolean } | null>(null);
  // Who just had a level saved: the "Saved" next to the boxes (I-11).
  const [savedUid, setSavedUid] = useState("");

  // The open question: the person and the click's request. Confirm runs what
  // used to come after the OK of window.confirm; for a level, on the roles the
  // list has AT THE MOMENT of confirming (see confirmAsked).
  const [asking, setAsking] = useState<
    | { kind: "waiver"; user: PlatformUser; waived: boolean }
    | { kind: "level"; user: PlatformUser; level: Level; next: boolean; question: keyof typeof LEVEL_QUESTIONS }
    | null
  >(null);

  function askWaiver(user: PlatformUser, waived: boolean) {
    if (waiverBusy || savingUid) return;
    // Another request started: the earlier "Saved" no longer speaks for this moment.
    setSavedUid("");
    setAsking({ kind: "waiver", user, waived });
  }

  async function applyWaiver(user: PlatformUser, waived: boolean) {
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

  // Only the response of the newest search counts: the one for "an" arriving after the one for
  // "ana" swapped the new list for the old one, and "loading" cleared on the
  // first response that arrived.
  const latestLoad = useRef(0);
  const load = useCallback(async (term: string) => {
    const request = ++latestLoad.current;
    setIsLoading(true);
    setError(null);
    try {
      const next = await listPlatformUsers(term);
      if (request === latestLoad.current) setUsers(next);
    } catch (caught) {
      if (request === latestLoad.current) setError({ scope: "load", key: refusalKey(caught, "loadError") });
    } finally {
      if (request === latestLoad.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounced so typing a name does not fire one query per keystroke.
    const timer = window.setTimeout(() => void load(search), 300);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  function requestLevel(user: PlatformUser, level: Level, next: boolean) {
    // A new click erases the earlier "Saved": with the question canceled it
    // stayed next to the boxes, as if the abandoned change had been saved.
    setSavedUid("");
    // Admin hands out every other level and Team opens refunds and the whole
    // catalog: never on a stray click. Same confirm the activation waiver
    // uses. Learner, Instructor and removing Team save directly, as before.
    const question = levelQuestion(level, next);
    if (question) {
      setAsking({ kind: "level", user, level, next, question });
      return;
    }
    void applyLevel(user, level, next);
  }

  function confirmAsked() {
    if (!asking) return;
    if (asking.kind === "waiver") return applyWaiver(asking.user, asking.waived);
    // The dialog keeps the question open for a while, and the delayed search can
    // bring newer roles in the meantime. Saving the click's roles would erase
    // that change: the admin enters or leaves on top of the current roles. If the person
    // left the list, nothing is saved (the dialog just closes).
    const current = users.find((entry) => entry.uid === asking.user.uid);
    return current ? applyLevel(current, asking.level, asking.next) : undefined;
  }

  async function applyLevel(user: PlatformUser, level: Level, next: boolean) {
    const nextRoles = toggleLevel(user.roles, level, next);
    setSavingUid(user.uid);
    setSavedUid("");
    setError(null);
    try {
      const saved = await setUserRoles(user.uid, nextRoles);
      setUsers((current) =>
        current.map((entry) =>
          entry.uid === user.uid ? { ...entry, roles: saved } : entry,
        ),
      );
      setSavedUid(user.uid);
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
    { value: "people", label: t(`${copy}.people`) },
    { value: "invitations", label: t("platformInvites.tab") },
    { value: "matrix", label: t(`${copy}.matrix`) },
  ];

  return (
    <section className="min-w-0 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      {accountTarget ? <AccountControlDialog key={accountTarget.uid} uid={accountTarget.uid} label={accountTarget.email || personLabel(accountTarget)} onClose={() => setAccountTarget(null)} /> : null}
      {/* The sentences are the same as the old window.confirm. Error and success
          notice stay in the list, where they already appeared. */}
      {asking ? (
        <ConfirmDialog
          title={asking.kind === "level"
            ? t(`${copy}.${LEVEL_QUESTIONS[asking.question][0]}`)
            : t(`platformInvites.${asking.waived ? "waiveTitle" : "requireTitle"}`)}
          confirmLabel={asking.kind === "level"
            ? t(`${copy}.${LEVEL_QUESTIONS[asking.question][1]}`)
            : t(`platformInvites.${asking.waived ? "waive" : "require"}`)}
          cancelLabel={t("platform.ops.confirmDialog.cancel")}
          danger={asking.kind === "level" || !asking.waived}
          onConfirm={confirmAsked}
          onClose={() => setAsking(null)}
        >
          {(asking.kind === "level"
            ? t(`${copy}.${LEVEL_QUESTIONS[asking.question][2]}`)
            : t(`platformInvites.${asking.waived ? "waiveConfirm" : "requireConfirm"}`)
          ).replace("{person}", () => personLabel(asking.user))}
        </ConfirmDialog>
      ) : null}
      {/* These switch panels: real tabs, in the single design (I-18). The
          arrows already switch the tab without a new search: the people list stays in
          the state here and the invites one loads once, on the first visit. */}
      <HorizontalTabs
        tabs={tabs}
        activeValue={tab}
        onChange={(value) => {
          const next = value as typeof tab;
          setTab(next);
          if (next === "invitations") setInvitationsOpened(true);
        }}
        ariaLabel={t(`${copy}.tabsLabel`)}
      />

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
              onChange={(event) => {
                setSearch(event.target.value);
                setSavedUid("");
              }}
              placeholder={t(`${copy}.searchPlaceholder`)}
              className="field-input min-h-11"
            />}
          </Field>

          {/* The "loading" row only the first time. On a new search the list
              stays in place, dimmed and inert until the response, instead of turning into a
              line of text and back, shrinking and growing the page (I-12). */}
          {isLoading && users.length === 0 ? (
            <p role="status" className="mt-6 text-sm text-[var(--color-ink-soft)]">
              {t(`${copy}.loading`)}
            </p>
          ) : users.length === 0 ? (
            error?.scope === "load" ? null : <p className="mt-6 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
          ) : (
            <ul aria-busy={isLoading || undefined} inert={isLoading} className={`mt-6 space-y-3 ${isLoading ? "opacity-60" : ""}`}>
              {users.map((user) => (
                <li
                  key={user.uid}
                  className="rounded-lg border border-[var(--color-line)] p-4"
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
                            requestLevel(user, level, event.target.checked)
                          }
                        />
                        {t(`${copy}.levels.${level.id}.label`)}
                      </label>
                    ))}
                    {/* Reserved space for the "Saved": it appears without pushing the
                        boxes or the buttons below (I-11). The live region stays
                        always mounted and only the text goes into it: region and text
                        born together are not always read. */}
                    <span role="status" className="inline-flex min-h-11 min-w-[7rem] items-center gap-1.5 text-sm font-semibold text-[var(--color-success-fg)]">
                      {savedUid === user.uid ? (
                        <>
                          <CheckCircle2 aria-hidden="true" size={16} className="shrink-0" />
                          {t(`${copy}.levelSaved`)}
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" disabled={waiverBusy || Boolean(savingUid)} className="min-h-11 max-w-full whitespace-normal" onClick={() => setAccountTarget(user)}>
                      <Shield size={16} className="shrink-0" aria-hidden />{t("accountControls.title")}
                    </Button>
                    <Button variant="outline" disabled={waiverBusy || Boolean(savingUid)} className="min-h-11 max-w-full whitespace-normal" onClick={() => askWaiver(user, true)}>
                      <CircleDollarSign size={16} className="shrink-0" aria-hidden />{t("platformInvites.waive")}
                    </Button>
                    <Button variant="outline" disabled={waiverBusy || Boolean(savingUid)} className="min-h-11 max-w-full whitespace-normal" onClick={() => askWaiver(user, false)}>
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
