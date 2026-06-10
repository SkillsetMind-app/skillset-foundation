"use client";

import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import { getFirestoreDb } from "@/lib/firebase/client";

const payoutLedgerCollection = "payoutLedger";

export function subscribeToTeacherPayoutLedger(
  teacherId: string,
  callback: (entries: PayoutLedgerEntry[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  // Equality filter + bounded limit with NO orderBy (single-field index only).
  // Without orderBy Firestore returns docs in __name__ order — effectively
  // arbitrary — so the limit must sit ABOVE any realistic ledger count or the
  // wallet money math sums an arbitrary subset (the old limit(50) did exactly
  // that past 50 payouts). Callers sort client-side.
  const payoutLedgerQuery = query(
    collection(getFirestoreDb(), payoutLedgerCollection),
    where("teacherId", "==", teacherId),
    limit(500),
  );

  return onSnapshot(
    payoutLedgerQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<PayoutLedgerEntry, "id">),
        })),
      );
    },
    onError,
  );
}
