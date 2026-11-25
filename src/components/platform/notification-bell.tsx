"use client";

import { Bell, BellOff, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { notificationHref, type AppNotification } from "@/domain/notification";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from "@/lib/data/notifications";

export function NotificationBell() {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const uid = status === "authenticated" ? user?.uid ?? null : null;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // Which uid the list arrived for, and which one the first read failed for. Before,
  // the bell said "You're all caught up" while the list had not arrived and, if the
  // read failed, forever. Now: a notification-shaped placeholder until the answer, an error
  // with "Try again" on failure, and "caught up" only when the database answered empty.
  // Storing the uid (rather than resetting inside the effect) avoids the cascading setState.
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [failedUid, setFailedUid] = useState<string | null>(null);
  // A "Mark all read" that failed: before, it stayed silent (the catch only swallowed it) and the person
  // thought they had marked them. The notifications stay unread; the panel says so.
  const [markAllFailed, setMarkAllFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!uid) {
      // No synchronous reset here (it would be a setState-in-effect cascade);
      // the component already renders null while signed out, and a fresh uid
      // re-subscribes below.
      return;
    }

    const current = subscribeToNotifications(
      uid,
      (incoming) => {
        setNotifications(incoming);
        setLoadedUid(uid);
        setFailedUid(null);
      },
      // A re-read that fails with the list already on screen keeps the list: before,
      // it emptied and the panel started saying "You're all caught up".
      () => setFailedUid(uid),
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [uid]);

  // On opening, focus enters the panel (on the title): someone using a keyboard or screen
  // reader lands inside it, and does not stay parked on the bell.
  useEffect(() => {
    if (open) {
      titleRef.current?.focus();
    }
  }, [open]);

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
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const loaded = uid !== null && loadedUid === uid;
  const loadFailed = !loaded && uid !== null && failedUid === uid;
  // Only the list that arrived for THIS uid counts; until then, nothing from another account.
  const items = useMemo(() => (loaded ? notifications : []), [loaded, notifications]);
  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items],
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
    setMarkAllFailed(false);
    try {
      await markAllNotificationsAsRead(uid, unreadIds);
    } catch {
      setMarkAllFailed(true);
    }
  }

  // "Try again" reads again through the same channel (see subscribeToNotifications).
  // The button disappears (the skeleton returns): focus goes to the panel title, instead
  // of falling onto the page.
  function retryLoad() {
    titleRef.current?.focus();
    setFailedUid(null);
    void subscription.current?.reload();
  }

  // Closing with the X or Esc returns focus to the bell, where the person came from.
  function closeToTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Filter client-side off the already-subscribed list (no re-query), then keep
  // the existing 6-item preview slice.
  const filtered =
    filter === "unread"
      ? items.filter((item) => !item.read)
      : items;
  const preview = filtered.slice(0, 6);

  return (
    // Below 768px the panel attaches to the top bar (like the search), not to the
    // bell: the account and the language sit to the right of the bell, and aligned to it the
    // 343px panel started off screen (x = -88 at 375px).
    <div
      ref={wrapperRef}
      className="relative max-md:static"
      onBlur={(event) => {
        // Tab out of the panel closes it, like Help beside it. Focus going to
        // "nowhere" (a click on text in the panel) does not close it.
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // Opening again starts clean: the earlier failure does not come back nor is it read
          // out again. (When closed, the panel does not exist; it only reopens through here.)
          if (!open) setMarkAllFailed(false);
          setOpen((current) => !current);
        }}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? t("platform.notifications.openUnread").replace(
                "{count}",
                String(unreadCount),
              )
            : t("platform.notifications.open")
        }
        className="relative grid size-11 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)] transition hover:bg-[var(--color-surface-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <Bell aria-hidden="true" size={18} strokeWidth={1.8} />
        {unreadCount > 0 ? (
          // White on brass gave 2.56:1; the navy of --color-on-accent gives 6.67:1.
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-bold leading-[18px] text-[var(--color-on-accent)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        // A popover, not a centered dialog: it stays attached to the bell (like Help) and
        // never goes past the screen height; the list scrolls inside. On a phone,
        // 16px from the right edge of the bar and at most the screen minus 32px: from
        // 320 to 767px at least 16px is left on both sides.
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          aria-busy={!loaded && !loadFailed}
          className="motion-drop-in absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[calc(100svh-96px)] w-[min(380px,calc(100vw-32px))] flex-col max-md:right-4 overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_48px_rgba(15,39,68,0.16)]"
        >
          {/* 44px targets (bell, X, "Mark all read", filters, "View all"): before they
              were 32px and about 24px tall, hard to hit on a phone. */}
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] py-1.5 pl-5 pr-2">
            <h4
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="rounded-sm text-[15px] font-bold text-[var(--color-primary)]"
            >
              {t("platform.notifications.title")}
            </h4>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="min-h-11 rounded-md px-3 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)]"
                >
                  {t("platform.notifications.markAllRead")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeToTrigger}
                className="grid size-11 place-items-center rounded-md text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
                aria-label={t("platform.notifications.close")}
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {/* On failure there is nothing to filter: the error and "Try again" stand alone.
              All/Unread filter the list, they do not switch panels: a group with
              aria-pressed (the standard for filters). The design here stays because
              the house segmented selector is 36px and the panel guarantees 44px. The
              hover only darkens the text: before, it painted the same background as the
              chosen one, and you could not tell which was on. */}
          <div
            role="group"
            hidden={loadFailed}
            aria-label={t("platform.notifications.filterLabel")}
            className="flex shrink-0 items-center gap-1 border-b border-[var(--color-line)] px-4 py-1"
          >
            {(["all", "unread"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-11 rounded-md px-3 text-xs font-semibold transition ${
                  filter === value
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                    : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                }`}
              >
                {value === "all"
                  ? t("platform.notifications.all")
                  : `${t("platform.notifications.unread")}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
              </button>
            ))}
          </div>
          {/* Only while unread notifications remain: read from another tab, the failure
              no longer applies. */}
          {markAllFailed && unreadCount > 0 ? (
            <InlineAlert tone="error" className="mx-4 mt-3 shrink-0">
              {t("platform.notifications.markAllError")}
            </InlineAlert>
          ) : null}
          {loadFailed ? (
            <div className="grid gap-3 p-5">
              <InlineAlert tone="error">{t("platform.notifications.loadError")}</InlineAlert>
              <button type="button" onClick={retryLoad} className="button-outline min-h-11 justify-self-start px-4 text-sm">
                {t("appErrors.retry")}
              </button>
            </div>
          ) : !loaded ? (
            // The shape of a notification (icon and three lines) until the list arrives.
            <div className="min-h-0 overflow-y-auto">
              <p className="sr-only" role="status">
                {t("platform.notifications.loading")}
              </p>
              <ul aria-hidden="true" className="divide-y divide-[var(--color-line)]">
                {["w-4/5", "w-2/3", "w-3/4"].map((width) => (
                  <li key={width} className="flex items-start gap-3 px-3 py-3">
                    <span className="mt-0.5 size-9 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-strong)]" />
                    <span className="grid flex-1 gap-2 pt-1">
                      <span className={`h-3 animate-pulse rounded-sm bg-[var(--color-surface-strong)] ${width}`} />
                      <span className="h-2.5 w-1/2 animate-pulse rounded-sm bg-[var(--color-surface-strong)]" />
                      <span className="h-2 w-1/5 animate-pulse rounded-sm bg-[var(--color-surface-strong)]" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : preview.length === 0 ? (
            <div className="min-h-0 overflow-y-auto px-5 py-10 text-center">
              <BellOff
                aria-hidden="true"
                size={32}
                strokeWidth={1.6}
                className="mx-auto text-[var(--color-ink-muted)]"
              />
              <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
                {t("platform.notifications.caughtUp")}
              </p>
              <p className="mx-auto mt-2 max-w-[220px] text-xs leading-5 text-[var(--color-ink-soft)]">
                {t("platform.notifications.caughtUpDetail")}
              </p>
            </div>
          ) : (
            <ul className="max-h-[360px] min-h-0 divide-y divide-[var(--color-line)] overflow-y-auto">
              {preview.map((notification) => (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notificationHref(notification) ?? notification.link}
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
          <div className="flex shrink-0 justify-center border-t border-[var(--color-line)] px-5">
            <Link
              href="/account/notifications"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)]"
            >
              {t("platform.notifications.viewAll")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
