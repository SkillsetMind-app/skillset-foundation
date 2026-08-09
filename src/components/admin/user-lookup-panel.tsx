"use client";

import { useDeferredValue, useEffect, useState } from "react";

import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToAdminUserProfiles } from "@/lib/data/admin-users";

export function UserLookupPanel() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
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
        setIsLoading(false);
      },
      () => {
        setError("We could not load user records. Confirm your admin access and try again.");
        setIsLoading(false);
      },
    );
  }, []);

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            User lookup
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            Find learners and educators.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Read-only account lookup for support and trust workflows. Role
            changes stay outside the client until an audited admin workflow exists.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {users.length} users
        </span>
      </div>

      <ListingSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search by email or username..."
        className="mt-6"
      />

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">Loading users...</p>
        ) : visibleUsers.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No users match this search.
          </p>
        ) : (
          visibleUsers.map((user) => (
            <article
              key={user.uid}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {user.displayName || "Unnamed user"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                    {user.email || "No email on profile"}
                  </p>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {user.roles.join(", ")}
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
