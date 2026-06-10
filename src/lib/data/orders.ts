"use client";

import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import type { Order } from "@/domain/order";
import { getFirestoreDb } from "@/lib/firebase/client";

const ordersCollection = "orders";

export function subscribeToOrder(
  orderId: string,
  callback: (order: Order | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), ordersCollection, orderId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({
        id: snapshot.id,
        ...(snapshot.data() as Omit<Order, "id">),
      });
    },
    onError,
  );
}

export function subscribeToRecentOrders(
  callback: (orders: Order[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const recentOrdersQuery = query(
    collection(getFirestoreDb(), ordersCollection),
    limit(12),
  );

  return onSnapshot(
    recentOrdersQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<Order, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeToUserOrders(
  userId: string,
  callback: (orders: Order[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  // Buyer-scoped history for the Billing -> Purchases / Invoices tabs.
  // Mirrors subscribeToTeacherOrders: an equality filter on the owning uid
  // plus a bounded limit, with NO orderBy, so it relies only on Firestore's
  // automatic single-field index (no composite index to deploy). Callers sort
  // by createdAt client-side. The orders read rule already authorizes
  // `resource.data.userId == request.auth.uid`, so this query is permitted.
  const userOrdersQuery = query(
    collection(getFirestoreDb(), ordersCollection),
    where("userId", "==", userId),
    limit(50),
  );

  return onSnapshot(
    userOrdersQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<Order, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeToTeacherOrders(
  teacherId: string,
  callback: (orders: Order[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  // Equality filter + bounded limit with NO orderBy (single-field index only;
  // nothing composite to deploy). Without orderBy Firestore returns docs in
  // __name__ order, which is effectively arbitrary — so the limit must sit
  // ABOVE any realistic order count or the wallet/insights money math sees an
  // arbitrary subset and reports wrong figures (the old limit(20) did exactly
  // that past 20 sales). Callers sort client-side; revisit with a composite
  // index + server-side pagination if teachers approach this bound.
  const teacherOrdersQuery = query(
    collection(getFirestoreDb(), ordersCollection),
    where("teacherId", "==", teacherId),
    limit(500),
  );

  return onSnapshot(
    teacherOrdersQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<Order, "id">),
        })),
      );
    },
    onError,
  );
}
