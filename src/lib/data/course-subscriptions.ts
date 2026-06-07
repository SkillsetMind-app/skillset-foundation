"use client";

import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";

import type { CourseSubscription } from "@/domain/course-subscription";
import { getFirestoreDb } from "@/lib/firebase/client";

/**
 * Live-subscribe to a single course-subscription mirror doc by its Stripe
 * subscription id. The doc id is read off the buyer's enrollment, so this is a
 * direct get (no query / composite index) gated by the own-read firestore rule.
 * Reacts in real time as the Stripe webhook updates status / cancelAtPeriodEnd.
 */
export function subscribeToCourseSubscription(
  subscriptionId: string,
  callback: (subscription: CourseSubscription | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), "courseSubscriptions", subscriptionId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({
        id: snapshot.id,
        ...(snapshot.data() as Omit<CourseSubscription, "id">),
      });
    },
    onError,
  );
}
