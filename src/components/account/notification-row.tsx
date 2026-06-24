"use client";

import {
  Award,
  Bell,
  GraduationCap,
  MessageCircle,
  Reply,
  Star,
} from "lucide-react";

import type { AppNotification, NotificationType } from "@/domain/notification";

const typeIcons: Record<NotificationType, typeof Bell> = {
  community_comment: MessageCircle,
  community_reply: Reply,
  enrollment: GraduationCap,
  course_review: Star,
  certificate: Award,
};

// Relative time from a Firestore server timestamp ({ seconds }). Coarse on
// purpose — the inbox is glanceable, not an audit log.
export function formatNotificationTime(createdAt: unknown): string {
  const seconds = (createdAt as { seconds?: number } | undefined)?.seconds;
  if (!seconds) {
    return "";
  }
  const deltaMs = Date.now() - seconds * 1000;
  if (deltaMs < 60_000) {
    return "Just now";
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(seconds * 1000).toLocaleDateString();
}

export function NotificationRow({
  notification,
}: {
  notification: AppNotification;
}) {
  const Icon = typeIcons[notification.type] ?? Bell;

  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <span
        className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${
          notification.read
            ? "bg-[var(--color-surface-soft)] text-[var(--color-ink-soft)]"
            : "bg-[rgba(44,82,130,0.1)] text-[var(--color-primary)]"
        }`}
      >
        <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-5 ${
            notification.read
              ? "font-medium text-[var(--color-ink)]"
              : "font-semibold text-[var(--color-primary)]"
          }`}
        >
          {notification.title}
        </p>
        {notification.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            {notification.body}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] font-medium text-[var(--color-ink-muted)]">
          {formatNotificationTime(notification.createdAt)}
        </p>
      </div>
      {!notification.read ? (
        <span
          aria-hidden="true"
          className="mt-2 size-2 shrink-0 rounded-full bg-[var(--color-accent)]"
        />
      ) : null}
    </div>
  );
}
