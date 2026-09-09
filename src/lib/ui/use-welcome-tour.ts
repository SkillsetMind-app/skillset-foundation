"use client";

import { useCallback, useEffect, useState } from "react";

import { claimWelcomeTour } from "@/lib/data/user-profiles";

// Share only in-flight requests: StrictMode's effect replay must receive the
// same reservation. A later visit asks the database again, never a cached win.
const pending = new Map<string, Promise<boolean>>();

export function useWelcomeTour(userId: string, surface: "student" | "teacher") {
  const key = `${userId}:${surface}`;
  const [claim, setClaim] = useState<{ key: string; open: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let request = pending.get(key);
    if (!request) {
      request = claimWelcomeTour(userId, surface).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    request.then((open) => {
      if (active) setClaim({ key, open });
    }, () => {
      if (!active) return;
      // Do not expose backend errors or obstruct the dashboard for an intro.
      console.warn("Welcome tour unavailable. It will be checked again on the next visit.");
      setClaim({ key, open: false });
    });
    return () => { active = false; };
  }, [key, userId, surface]);

  const dismiss = useCallback(() => {
    setClaim((current) => current?.key === key ? { key, open: false } : current);
  }, [key]);

  return { open: claim?.key === key && claim.open, dismiss };
}
