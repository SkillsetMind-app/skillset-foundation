"use client";

import { Bell, BellOff, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import type { AppNotification } from "@/domain/notification";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from "@/lib/data/notifications";

export function NotificationBell() {
  const { status, user } = useAuth();
  const uid = status === "authenticated" ? user?.uid ?? null : null;

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!uid) {
      // No synchronous reset here (it would be a setState-in-effect cascade);
      // the component already renders null while signed out, and a fresh uid
      // re-subscribes below.
      return;
    }

    return subscribeToNotifications(
      uid,
      setNotifications,
      () => setNotifications([]),
    );
  }, [uid]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications],
  );

  // The bell lives in the authenticated shell, but guard so a signed-out or
  // still-loading render is inert rather than throwing on a null uid.
  if (!uid) {
    return null;
  }

  async function handleActivate(notification: AppNotification) {
    if (!uid || notification.read) {
      return;
    }
    try {
      await markNotificationAsRead(uid, notification.id);
    } catch {
      // Read-state is non-critical; the realtime subscription stays correct.
    }
  }

  async function handleMarkAll() {
    if (!uid) {
      return;
    }
    const unreadIds = notifications
      .filter((item) => !item.read)
      .map((item) => item.id);
    if (unreadIds.length === 0) {
      return;
    }
    try {
      await markAllNotificationsAsRead(uid, unreadIds);
    } catch {
      // Non-critical.
    }
  }

  const preview = notifications.slice(0, 6);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Open notifications, ${unreadCount} unread`
            : "Open notifications"
        }
        className="relative grid size-10 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)] transition hover:bg-[var(--color-surface-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
      >
        <Bell aria-hidden="true" size={18} strokeWidth={1.8} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-bold leading-[18px] text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-[14px] border border-[var(--color-line)] bg-white shadow-[0_24px_48px_rgba(15,39,68,0.16)]">
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
            <h4 className="text-[15px] font-bold text-[var(--color-primary)]">
              Notifications
            </h4>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="rounded-[8px] px-2 py-1 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)]"
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-[8px] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
                aria-label="Close notifications"
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {preview.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <BellOff
                aria-hidden="true"
                size={32}
                strokeWidth={1.6}
                className="mx-auto text-[var(--color-ink-muted)]"
              />
              <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
                You&apos;re all caught up
              </p>
              <p className="mx-auto mt-2 max-w-[220px] text-xs leading-5 text-[var(--color-ink-soft)]">
                Skillset will let you know when something needs your attention.
              </p>
            </div>
          ) : (
            <ul className="max-h-[360px] divide-y divide-[var(--color-line)] overflow-y-auto">
              {preview.map((notification) => (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      onClick={() => {
                        void handleActivate(notification);
                        setOpen(false);
                      }}
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
          <div className="border-t border-[var(--color-line)] px-5 py-3 text-center">
            <Link
              href="/account/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-[var(--color-primary)]"
            >
              View all
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
