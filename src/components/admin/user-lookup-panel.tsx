"use client";

import { useDeferredValue, useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { InlineAlert } from "@/components/ui";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToAdminUserProfiles } from "@/lib/data/admin-users";
import type { Role } from "@/lib/permissions";

const roleLabelKeys = {
  guest: "platform.ops.usersPanel.roles.guest",
  student: "roles.learner",
  teacher: "platform.ops.accessPanel.levels.teacher.label",
  admin: "roles.admin",
  support: "roles.support",
  moderator: "platform.ops.usersPanel.roles.moderator",
  ops: "platform.crumbs.ops",
} satisfies Record<Role, string>;

export function UserLookupPanel() {
  const { t } = useTranslation();
  const copy = "platform.ops.usersPanel";
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const deferredQuery = useDeferredValue(query.toLowerCase().trim());
  const visibleUsers = users.filter((user) => {
    if (!deferredQuery) {
      return true;
    }

    return `${user.displayName ?? ""} ${user.email ?? ""} ${user.uid}`
      .toLowerCase()
      .includes(deferredQuery);
  });

  useEffect(() => {
    return subscribeToAdminUserProfiles(
      (nextUsers) => {
        setUsers(nextUsers);
        setError(false);
        setIsLoading(false);
      },
      () => {
        setError(true);
        setIsLoading(false);
      },
    );
  }, []);

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t(`${copy}.eyebrow`)}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        {!isLoading && !error ? <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">{t(`${copy}.${users.length === 1 ? "countOne" : "count"}`).replace("{count}", () => String(users.length))}</span> : null}
      </div>

      <ListingSearchBar
        value={query}
        onChange={setQuery}
        placeholder={t(`${copy}.search`)}
        className="mt-6 min-h-11"
      />

      {error ? (
        <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t(`${copy}.loading`)}</p>
        ) : visibleUsers.length === 0 ? (
          error ? null : <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
        ) : (
          visibleUsers.map((user) => (
            <article
              key={user.uid}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-[var(--color-ink)]">
                    {user.displayName || t(`${copy}.unnamed`)}
                  </p>
                  <p className="mt-1 break-all text-xs text-[var(--color-ink-soft)]">
                    {user.email || t(`${copy}.noEmail`)}
                  </p>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {user.roles.map(role => Object.hasOwn(roleLabelKeys, role) ? t(roleLabelKeys[role]) : role.replaceAll("_", " ")).join(", ")}
                </span>
              </div>
              <p className="mt-3 break-all text-xs text-[var(--color-ink-soft)]">
                UID: {user.uid}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
