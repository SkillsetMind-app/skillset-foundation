"use client";

import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { notificationHref, type AppNotification } from "@/domain/notification";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from "@/lib/data/notifications";

export function NotificationsInbox() {
  const { t } = useTranslation();
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
      { value: "all", label: t("accountNotifications.all") },
      {
        value: "unread",
        label: unreadIds.length > 0 ? `${t("accountNotifications.unread")} (${unreadIds.length})` : t("accountNotifications.unread"),
      },
    ],
    [unreadIds.length, t],
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
      {/* The unread count lives only on the "Unread (N)" tab: the phrase "N
          unread" up here repeated the same number. The two buttons are the
          platform's, with 44px targets. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href="/account?tab=notifications" className={buttonClasses({ variant: "outline" })}>
          {t("accountNotifications.preferences")}
        </Link>
        {unreadIds.length > 0 ? (
          <Button icon={<CheckCheck aria-hidden="true" size={16} strokeWidth={2} />} onClick={handleMarkAll}>
            {t("accountNotifications.markAll")}
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]">
        <HorizontalTabs
          tabs={notificationTabs}
          activeValue={filter}
          onChange={(value) => setFilter(value as "all" | "unread")}
          ariaLabel={t("accountNotifications.filter")}
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
          // The standard empty inbox, with the same texts; h2 right below the page's
          // h1 (before, they were two loose paragraphs under an icon).
          <EmptyState
            as="h2"
            title={t(filter === "unread" && items.length > 0 ? "accountNotifications.caughtUp" : "accountNotifications.empty")}
            description={t(filter === "unread" && items.length > 0 ? "accountNotifications.caughtUpBody" : "accountNotifications.emptyBody")}
            className="m-4 sm:m-6"
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {visible.map((notification) => (
              <li key={notification.id}>
                {notification.link ? (
                  <Link
                    href={notificationHref(notification) ?? notification.link}
                    onClick={() => void handleActivate(notification)}
                    className="block transition-colors duration-[var(--duration-base)] hover:bg-[var(--color-surface-soft)]"
                  >
                    <NotificationRow notification={notification} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleActivate(notification)}
                    className="block w-full text-left transition-colors duration-[var(--duration-base)] hover:bg-[var(--color-surface-soft)]"
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
