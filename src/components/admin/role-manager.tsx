"use client";

import { useCallback, useEffect, useState } from "react";

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
  label: string;
  description: string;
  /** A level is ON when every role it maps to is present. */
  roles: readonly Role[];
};

const LEVELS: readonly Level[] = [
  {
    id: "student",
    label: "Learner",
    description: "Buys and takes courses. The classroom, nothing else.",
    roles: ["student"],
  },
  {
    id: "teacher",
    label: "Instructor",
    description: "Builds and sells courses. Opens the teaching studio.",
    roles: ["teacher"],
  },
  {
    id: "staff",
    label: "Team",
    description:
      "Verification, reports and learner support — support, moderation and operations together.",
    roles: ["support", "moderator", "ops"],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Everything, including changing these levels.",
    roles: ["admin"],
  },
];

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
  const [tab, setTab] = useState<"people" | "matrix">("people");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingUid, setSavingUid] = useState("");

  const load = useCallback(async (term: string) => {
    setIsLoading(true);
    setError("");
    try {
      setUsers(await listPlatformUsers(term));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the roster.",
      );
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
    setError("");
    try {
      const saved = await setUserRoles(user.uid, nextRoles);
      setUsers((current) =>
        current.map((entry) =>
          entry.uid === user.uid ? { ...entry, roles: saved } : entry,
        ),
      );
    } catch (caught) {
      // The database refuses to strip your own admin role or to empty the admin
      // set. Surface its sentence rather than a generic failure — it names the
      // exact rule that stopped the change.
      setError(
        caught instanceof Error
          ? caught.message
          : "That change was refused. Nothing was saved.",
      );
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
    { id: "people" as const, label: "People" },
    { id: "matrix" as const, label: "What each level can do" },
  ];

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={`rounded-[10px] px-4 py-2 text-sm font-bold transition ${
              tab === entry.id
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-line)] text-[var(--color-ink-soft)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {error}
        </p>
      ) : null}

      {tab === "people" ? (
        <div className="mt-6">
          <label className="block text-sm font-semibold text-[var(--color-ink)]">
            Find someone
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or email"
              className="mt-2 w-full rounded-[10px] border border-[var(--color-line)] px-4 py-2.5 text-sm font-normal"
            />
          </label>

          {isLoading ? (
            <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
              Loading the roster…
            </p>
          ) : users.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
              No one matches that search.
            </p>
          ) : (
            <ul className="mt-6 space-y-3">
              {users.map((user) => (
                <li
                  key={user.uid}
                  className="rounded-[12px] border border-[var(--color-line)] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-[var(--color-ink)]">
                      {personLabel(user)}
                    </p>
                    {user.email ? (
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {user.email}
                      </p>
                    ) : null}
                  </div>

                  {user.roles.length === 0 ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      No level yet — sees only the public site.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-4">
                    {LEVELS.map((level) => (
                      <label
                        key={level.id}
                        title={level.description}
                        className="inline-flex items-center gap-2 text-sm text-[var(--color-ink)]"
                      >
                        <input
                          type="checkbox"
                          checked={hasLevel(user.roles, level)}
                          disabled={savingUid === user.uid}
                          onChange={(event) =>
                            void applyLevel(user, level, event.target.checked)
                          }
                        />
                        {level.label}
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--color-line)] py-2 pr-4 font-bold">
                  Can do
                </th>
                {LEVELS.map((level) => (
                  <th
                    key={level.id}
                    className="border-b border-[var(--color-line)] py-2 pr-4 font-bold"
                  >
                    {level.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPermissionDefinitions.map((definition) => (
                <tr key={definition.key}>
                  <td
                    className="border-b border-[var(--color-line)] py-2 pr-4 text-[var(--color-ink-soft)]"
                    title={definition.description}
                  >
                    {definition.label}
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
                        <span aria-label={allowed ? "yes" : "no"}>
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
      )}
    </section>
  );
}
