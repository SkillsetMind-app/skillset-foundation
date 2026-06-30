"use client";

import { BellOff, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import type { AppNotification } from "@/domain/notification";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from "@/lib/data/notifications";

export function NotificationsInbox() {
  const { status, user } = useAuth();
  const uid = status === "authenticated" ? user?.uid ?? null : null;
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // Which uid the current `notifications` array was delivered for. Until it
  // matches the active uid we treat the list as still loading. Tracking this as
  // state (instead of resetting inside the effect) keeps the effect free of a
  // synchronous setState cascade and never shows another account's items.
  const [loadedUid, setLoadedUid] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      return;
    }

    return subscribeToNotifications(
      uid,
      (incoming) => {
        setNotifications(incoming);
        setLoadedUid(uid);
      },
      () => {
        setNotifications([]);
        setLoadedUid(uid);
      },
    );
  }, [uid]);

  // Derived during render (not in an effect): signed-out shows nothing and
  // mirrors auth loading; signed-in shows items only once they arrived for THIS
  // uid, otherwise the loading skeleton. Memoized so the fallback `[]` keeps a
  // stable reference and the downstream useMemos don't recompute every render.
  const items = useMemo(
    () => (uid && loadedUid === uid ? notifications : []),
    [uid, loadedUid, notifications],
  );
  const loading = uid ? loadedUid !== uid : status === "loading";

  const unreadIds = useMemo(
    () => items.filter((item) => !item.read).map((item) => item.id),
    [items],
  );

  // Client-side filter over the already-loaded list — no extra query.
  const visible = useMemo(
    () => (filter === "unread" ? items.filter((item) => !item.read) : items),
    [items, filter],
  );

  const notificationTabs = useMemo(
    () => [
      { value: "all", label: "All" },
      {
        value: "unread",
        label: unreadIds.length > 0 ? `Unread (${unreadIds.length})` : "Unread",
      },
    ],
    [unreadIds.length],
  );

  async function handleMarkAll() {
    if (!uid || unreadIds.length === 0) {
      return;
    }
    try {
      await markAllNotificationsAsRead(uid, unreadIds);
    } catch {
      // Read-state is non-critical; the realtime subscription stays correct.
    }
  }

  async function handleActivate(notification: AppNotification) {
    if (!uid || notification.read) {
      return;
    }
    try {
      await markNotificationAsRead(uid, notification.id);
    } catch {
      // Non-critical.
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {unreadIds.length > 0
            ? `${unreadIds.length} unread`
            : "You're all caught up"}
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/account?tab=notifications"
            className="rounded-[10px] border border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] transition hover:bg-[var(--color-surface-soft)]"
          >
            Notification preferences
          </Link>
          {unreadIds.length > 0 ? (
            <button
              type="button"
              onClick={handleMarkAll}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
            >
              <CheckCheck aria-hidden="true" size={14} strokeWidth={2} />
              Mark all read
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]">
        <HorizontalTabs
          tabs={notificationTabs}
          activeValue={filter}
          onChange={(value) => setFilter(value as "all" | "unread")}
          ariaLabel="Filter notifications"
          className="px-2"
        />
        {loading ? (
          <div aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-[76px] animate-pulse border-b border-[var(--color-line)] bg-[var(--color-surface-strong)] last:border-b-0"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <BellOff
              aria-hidden="true"
              size={36}
              strokeWidth={1.5}
              className="mx-auto text-[var(--color-ink-muted)]"
            />
            <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
              {filter === "unread" && items.length > 0
                ? "You're all caught up"
                : "No notifications yet"}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--color-ink-soft)]">
              {filter === "unread" && items.length > 0
                ? "Nothing unread right now. Switch to All to see your earlier notifications."
                : "Replies to your posts, new reviews on your courses, and enrollment updates will show up here."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {visible.map((notification) => (
              <li key={notification.id}>
                {notification.link ? (
                  <Link
                    href={notification.link}
                    onClick={() => void handleActivate(notification)}
                    className="block transition hover:bg-[var(--color-surface-soft)]"
                  >
                    <NotificationRow notification={notification} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleActivate(notification)}
                    className="block w-full text-left transition hover:bg-[var(--color-surface-soft)]"
                  >
                    <NotificationRow notification={notification} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
