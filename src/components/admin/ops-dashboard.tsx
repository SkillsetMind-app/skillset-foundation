"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import { AccountActionRequestsPanel } from "@/components/admin/account-action-requests-panel";
import { AdminEnrollmentPanel } from "@/components/admin/admin-enrollment-panel";
import { CommunityModerationQueue } from "@/components/admin/community-moderation-queue";
import { CourseReviewQueue } from "@/components/admin/course-review-queue";
import { ManagedCoursePanel } from "@/components/admin/managed-course-panel";
import { OpsOverviewMetrics } from "@/components/admin/ops-overview-metrics";
import { PaymentOperationsPanel } from "@/components/admin/payment-operations-panel";
import { SupportTicketQueue } from "@/components/admin/support-ticket-queue";
import { UserLookupPanel } from "@/components/admin/user-lookup-panel";
import { DashboardFilters } from "@/components/shared/dashboard-filters";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import {
  subscribeToAuditLog,
  type AuditLogEntry,
} from "@/lib/data/audit-log";

const opsTabs = [
  { value: "courses", label: "Courses in review" },
  { value: "payments", label: "Payments" },
  { value: "community", label: "Community reports" },
  { value: "support", label: "Support tickets" },
  { value: "users", label: "Users" },
  { value: "audit", label: "Audit log" },
];

const periodOptions = [
  { value: "today", label: "Today" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
];

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
];

export function OpsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "courses";
  const period = searchParams.get("period") ?? "last_7d";
  const status = searchParams.get("status") ?? "all";
  const filters = useMemo(
    () => [
      { key: "period", label: "Period", value: period, options: periodOptions },
      { key: "status", label: "Status", value: status, options: statusOptions },
    ],
    [period, status],
  );

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);

    startTransition(() => {
      router.replace(`/ops?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
        <HorizontalTabs
          tabs={opsTabs}
          activeValue={activeTab}
          onChange={(value) => updateParam("tab", value)}
          ariaLabel="Operations queues"
        />
        <div className="mt-5">
          <DashboardFilters filters={filters} onChange={updateParam} />
        </div>
      </section>

      <OpsOverviewMetrics />

      {activeTab === "payments" ? (
        <>
          <PaymentOperationsPanel />
          <AdminEnrollmentPanel />
        </>
      ) : activeTab === "community" ? (
        <CommunityModerationQueue />
      ) : activeTab === "support" ? (
        <SupportTicketQueue />
      ) : activeTab === "users" ? (
        <>
          <UserLookupPanel />
          <AccountActionRequestsPanel />
        </>
      ) : activeTab === "audit" ? (
        <AuditLogPanel />
      ) : (
        <>
          <CourseReviewQueue />
          <ManagedCoursePanel />
        </>
      )}
    </div>
  );
}

const auditActionLabels: Record<string, string> = {
  "refund.requested": "Refund requested",
  "refund.issued": "Refund issued",
  "account.deletion_requested": "Account deletion requested",
  "account.data_export_requested": "Data export requested",
};

function formatAuditTimestamp(entry: AuditLogEntry) {
  // Postgres timestamptz comes back as an ISO string, not a Firestore Timestamp.
  const raw = entry.createdAt;
  const date = typeof raw === "string" && raw ? new Date(raw) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Pending timestamp";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToAuditLog(
      (nextEntries) => {
        setEntries(nextEntries);
        setIsLoading(false);
      },
      () => {
        setError("We could not load the audit log.");
        setIsLoading(false);
      },
    );
  }, []);

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Audit log
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        Sensitive actions across the platform.
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Refunds and account requests are recorded here automatically as they
        happen, newest first. This log is read-only — entries are written by
        the system and cannot be edited.
      </p>

      <div className="mt-5 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading audit log...
          </p>
        ) : error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-5 text-sm leading-7 text-[var(--color-ink-soft)]">
            No audit events recorded yet.
          </div>
        ) : (
          entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[var(--color-ink)]">
                    {auditActionLabels[entry.action] ?? entry.action}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                    {entry.summary}
                  </p>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {entry.targetType}
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
                Actor {entry.actorEmail ?? entry.actorId} - {formatAuditTimestamp(entry)}
                {" - Target "}
                {entry.targetId}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
