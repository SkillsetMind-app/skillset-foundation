"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountActionRequestsPanel } from "@/components/admin/account-action-requests-panel";
import { AdminEnrollmentPanel } from "@/components/admin/admin-enrollment-panel";
import { CommunityModerationQueue } from "@/components/admin/community-moderation-queue";
import { CreatorVerificationQueue } from "@/components/admin/creator-verification-queue";
import { ManagedCoursePanel } from "@/components/admin/managed-course-panel";
import { useOpsQueueCounts } from "@/components/admin/ops-overview-metrics";
import { PaymentOperationsPanel } from "@/components/admin/payment-operations-panel";
import { RoleManager } from "@/components/admin/role-manager";
import { SupportTicketQueue } from "@/components/admin/support-ticket-queue";
import { UserLookupPanel } from "@/components/admin/user-lookup-panel";
import { ViewAsSwitcher } from "@/components/admin/view-as";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformShell } from "@/components/platform/platform-shell";
import { canAccessPlatformNavItem, getOpsNavItem } from "@/data/site";
import {
  subscribeToAuditLog,
  type AuditLogEntry,
} from "@/lib/data/audit-log";

export function OpsDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const currentItem = getOpsNavItem(searchParams.get("tab"));
  const activeTab = currentItem.tab;
  const canOpenQueue = canAccessPlatformNavItem(user, currentItem);
  const counts = useOpsQueueCounts();
  const query = searchParams.get("q") ?? "";
  const queueSearchParams = new URLSearchParams(searchParams.toString());
  queueSearchParams.set("tab", activeTab);
  const searchHref = canOpenQueue && (activeTab === "verification" || activeTab === "support")
    ? `/ops?${queueSearchParams.toString()}`
    : null;

  return (
    <PlatformShell
      title={t("platform.nav.operations")}
      compact
      currentNavigationHref={currentItem.href}
      searchHref={searchHref}
      navigationCounts={{
        [getOpsNavItem("verification").href]: counts.pendingVerifications,
        [getOpsNavItem("community").href]: counts.openReports,
        [getOpsNavItem("support").href]: counts.openTickets,
      }}
    >
      <div className="grid min-w-0 gap-5">
        {!canOpenQueue ? (
          <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-6">
            <p role="alert" className="text-sm text-[var(--color-ink)]">
              {t("platform.ops.unavailable")}
            </p>
            <Link
              href="/ops"
              className="mt-4 inline-flex min-h-11 items-center rounded-[10px] px-3 text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4"
            >
              {t("platform.ops.back")}
            </Link>
          </section>
        ) : activeTab === "access" ? (
          <section className="grid gap-5">
            <h2 className="text-base font-bold text-[var(--color-ink)]">
              {t("platform.ops.accessLevels")}
            </h2>
            <ViewAsSwitcher />
            <RoleManager />
          </section>
        ) : activeTab === "verification" ? (
          <CreatorVerificationQueue query={query} />
        ) : activeTab === "catalog" ? (
          <ManagedCoursePanel />
        ) : activeTab === "payments" ? (
          <>
            <PaymentOperationsPanel />
            <AdminEnrollmentPanel />
          </>
        ) : activeTab === "community" ? (
          <CommunityModerationQueue />
        ) : activeTab === "support" ? (
          <SupportTicketQueue query={query} />
        ) : activeTab === "users" ? (
          <>
            <UserLookupPanel />
            <AccountActionRequestsPanel />
          </>
        ) : activeTab === "audit" ? (
          <AuditLogPanel />
        ) : null}
      </div>
    </PlatformShell>
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
      {/* Era mais uma camada de título antes da tabela: sobretítulo, manchete
          de 30px em serifa e parágrafo. Título de 16px e a lista. */}
      <h3 className="text-base font-bold text-[var(--color-ink)]">
        Audit log
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
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
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
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
