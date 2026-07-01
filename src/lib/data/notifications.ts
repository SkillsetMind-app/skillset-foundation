"use client";

import type { AppNotification, NotificationType } from "@/domain/notification";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

// Bounded so a long-lived account can't stream an unbounded inbox to the bell.
// The newest 50 cover the bell preview and the inbox page; older ones age out.
const NOTIFICATIONS_LIMIT = 50;

function rowToNotification(row: NotificationRow): AppNotification {
  return {
    id: row.notification_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    read: row.read,
    link: row.link,
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

export function subscribeToNotifications(
  userId: string,
  callback: (notifications: AppNotification[]) => void,
  onError: (error: Error) => void,
): () => void {
  // createdAt is server-written on every notification (clients never create
  // them), so there is no pending-write null to corrupt the ordering — sorting
  // by created_at desc is safe.
  //
  // Query construction touches getSupabaseBrowserClient(), which may throw
  // synchronously if the client config is absent. The bell mounts this inside
  // an effect across the whole authenticated shell, so a raw throw here would
  // blow up the shell instead of degrading; route it through onError and hand
  // back a no-op unsubscribe so the inbox simply renders empty.
  try {
    const supabase = getSupabaseBrowserClient();

    const load = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_LIMIT);

      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      callback((data ?? []).map(rowToNotification));
    };

    void load();

    // Re-fetch on any change to the caller's rows so the ordered list stays
    // exact, like Firestore onSnapshot re-emitting the full query result.
    // RLS scopes the subscription to the caller's own notifications.
    const channel = supabase
      .channel(`notifications:user:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return () => {};
  }
}

export async function markNotificationAsRead(
  userId: string,
  notificationId: string,
): Promise<void> {
  // The RLS policy allows the owner to change ONLY `read` — any other key
  // in this write would reject the whole update.
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("notification_id", notificationId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}

export async function markAllNotificationsAsRead(
  userId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) {
    return;
  }

  // One batched update over the currently-unread set. It is bounded by the
  // 50-doc subscription cap, comfortably within Postgres limits.
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .in("notification_id", notificationIds)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}
