"use client";

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import type { AppNotification } from "@/domain/notification";
import { getFirestoreDb } from "@/lib/firebase/client";

// Bounded so a long-lived account can't stream an unbounded inbox to the bell.
// The newest 50 cover the bell preview and the inbox page; older ones age out.
const NOTIFICATIONS_LIMIT = 50;

function notificationsCollection(userId: string) {
  return collection(getFirestoreDb(), "users", userId, "notifications");
}

export function subscribeToNotifications(
  userId: string,
  callback: (notifications: AppNotification[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  // createdAt is server-written on every notification (clients never create
  // them), so there is no pending-write null to corrupt the ordering — orderBy
  // is safe and uses the automatic single-field index (no composite needed).
  //
  // Query construction touches getFirestoreDb(), which throws synchronously if
  // the Firebase client config is absent (or init otherwise fails). The bell
  // mounts this inside an effect across the whole authenticated shell, so a raw
  // throw here would blow up the shell instead of degrading; route it through
  // onError and hand back a no-op unsubscribe so the inbox simply renders empty.
  try {
    const notificationsQuery = query(
      notificationsCollection(userId),
      orderBy("createdAt", "desc"),
      limit(NOTIFICATIONS_LIMIT),
    );

    // onSnapshot returns synchronously; runtime listener failures still surface
    // asynchronously through the onError argument, so only the synchronous setup
    // above is shielded by this catch.
    return onSnapshot(
      notificationsQuery,
      (snapshot) => {
        callback(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...(document.data() as Omit<AppNotification, "id">),
          })),
        );
      },
      onError,
    );
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return () => {};
  }
}

export async function markNotificationAsRead(
  userId: string,
  notificationId: string,
): Promise<void> {
  // The security rule allows the owner to change ONLY `read` — any other key
  // in this write would reject the whole update.
  await updateDoc(
    doc(getFirestoreDb(), "users", userId, "notifications", notificationId),
    { read: true },
  );
}

export async function markAllNotificationsAsRead(
  userId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) {
    return;
  }

  // One batched write over the currently-unread set. It is bounded by the
  // 50-doc subscription cap, comfortably under the 500-op batch limit.
  const db = getFirestoreDb();
  const batch = writeBatch(db);
  for (const id of notificationIds) {
    batch.update(doc(db, "users", userId, "notifications", id), { read: true });
  }
  await batch.commit();
}
