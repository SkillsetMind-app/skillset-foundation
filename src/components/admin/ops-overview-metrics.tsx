"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canAccessPlatformNavItem,
  getOpsNavItem,
  type PlatformNavCount,
} from "@/data/site";
import { subscribeToAccountActionRequests } from "@/lib/data/account-actions";
import { subscribeToCommunityReports } from "@/lib/data/community-posts";
import { subscribeToVerificationQueue } from "@/lib/data/creator-verification";
import { subscribeToAdminSupportTickets } from "@/lib/data/support-tickets";

export type OpsQueueCounts = {
  pendingVerifications: PlatformNavCount;
  openTickets: PlatformNavCount;
  openReports: PlatformNavCount;
  /** Deletion/export requests still pending or processing (30-day clock). */
  openPrivacyRequests: PlatformNavCount;
};

// One owner in OpsDashboard supplies both navigation surfaces. Each queue has
// its own loading/error state; a successful read is the only source of zero.
export function useOpsQueueCounts(): OpsQueueCounts {
  const { user } = useAuth();
  const canReadVerification = canAccessPlatformNavItem(user, getOpsNavItem("verification"));
  const canReadSupport = canAccessPlatformNavItem(user, getOpsNavItem("support"));
  const canReadReports = canAccessPlatformNavItem(user, getOpsNavItem("community"));
  const canReadPrivacy = canAccessPlatformNavItem(user, getOpsNavItem("users"));
  const scope = `${user?.uid ?? ""}:${canReadVerification}:${canReadSupport}:${canReadReports}:${canReadPrivacy}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    values: Partial<OpsQueueCounts>;
  }>({ scope, values: {} });

  // Clear on every committed transition, including A -> B -> A before any
  // queue responds. Comparing an old snapshot with A again would revive it.
  if (snapshot.scope !== scope) {
    setSnapshot({ scope, values: {} });
  }

  useEffect(() => {
    let active = true;
    const stops: Array<() => void> = [];

    function updateCount(key: keyof OpsQueueCounts, value: PlatformNavCount) {
      if (!active) return;
      setSnapshot((previous) => ({
        scope,
        values: { ...(previous.scope === scope ? previous.values : {}), [key]: value },
      }));
    }

    function watch<T>(
      enabled: boolean,
      key: keyof OpsQueueCounts,
      subscribe: (next: (rows: T[]) => void, error: (error: Error) => void) => () => void,
      count: (rows: T[]) => number,
    ) {
      if (!enabled) return;
      try {
        stops.push(
          subscribe(
            (rows) => updateCount(key, count(rows)),
            () => updateCount(key, "unavailable"),
          ),
        );
      } catch {
        // A missing data client must not crash navigation or expose raw errors.
        updateCount(key, "unavailable");
      }
    }

    watch(canReadVerification, "pendingVerifications", subscribeToVerificationQueue,
      (rows) => rows.length);
    watch(canReadSupport, "openTickets", subscribeToAdminSupportTickets,
      (rows) => rows.filter((ticket) => ticket.status !== "resolved").length);
    watch(canReadReports, "openReports", subscribeToCommunityReports,
      (rows) => rows.filter((report) => report.status === "open").length);
    // The read returns every open request (only closed history is capped), so
    // this count is complete.
    watch(canReadPrivacy, "openPrivacyRequests", subscribeToAccountActionRequests,
      (rows) => rows.filter((request) => request.status === "pending" || request.status === "processing").length);

    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [scope, canReadVerification, canReadSupport, canReadReports, canReadPrivacy]);

  // Role/account changes cannot briefly expose an earlier session's counts.
  const counts = snapshot.scope === scope ? snapshot.values : {};

  return {
    pendingVerifications: canReadVerification ? counts.pendingVerifications ?? "loading" : "unavailable",
    openTickets: canReadSupport ? counts.openTickets ?? "loading" : "unavailable",
    openReports: canReadReports ? counts.openReports ?? "loading" : "unavailable",
    openPrivacyRequests: canReadPrivacy ? counts.openPrivacyRequests ?? "loading" : "unavailable",
  };
}
