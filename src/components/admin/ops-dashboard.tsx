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
import { InlineAlert } from "@/components/ui";
import { canAccessPlatformNavItem, getOpsNavItem } from "@/data/site";
import {
  subscribeToAuditLog,
  type AuditLogEntry,
} from "@/lib/data/audit-log";
import { toDate } from "@/lib/format-date";

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
  "refund.requested": "actions.refundRequested",
  "refund.issued": "actions.refundIssued",
  "account.deletion_requested": "actions.deletionRequested",
  "account.data_export_requested": "actions.exportRequested",
};

const auditTargetLabels: Record<string, string> = {
  order: "targets.order",
  user: "targets.user",
  course: "targets.course",
};

function formatAuditLabel(value: string, labels: Record<string, string>, t: (key: string) => string) {
  return Object.hasOwn(labels, value) ? t(`platform.ops.auditPanel.${labels[value]}`) : value.replace(/[._]/g, " ");
}

function formatAuditTimestamp(entry: AuditLogEntry, locale: string, pending: string) {
  const date = toDate(entry.createdAt);

  if (!date) {
    return pending;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function AuditLogPanel() {
  const { t, locale } = useTranslation();
  const copy = "platform.ops.auditPanel";
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    return subscribeToAuditLog(
      (nextEntries) => {
        setEntries(nextEntries);
        setError(false);
        setIsLoading(false);
      },
      () => {
        setError(true);
        setIsLoading(false);
      },
    );
  }, []);

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      {/* Era mais uma camada de título antes da tabela: sobretítulo, manchete
          de 30px em serifa e parágrafo. Título de 16px e a lista. */}
      <h3 className="text-base font-bold text-[var(--color-ink)]">
        {t("platform.ops.audit")}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t(`${copy}.description`)}
      </p>

      <div className="mt-5 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.loading`)}
          </p>
        ) : error ? (
          <InlineAlert tone="error">{t(`${copy}.loadError`)}</InlineAlert>
        ) : entries.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-5 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t(`${copy}.empty`)}
          </div>
        ) : (
          entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--color-ink)]">
                    {formatAuditLabel(entry.action, auditActionLabels, t)}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                    {entry.summary}
                  </p>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {formatAuditLabel(entry.targetType, auditTargetLabels, t)}
                </span>
              </div>
              <p className="mt-3 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                {t(`${copy}.actor`)} {entry.actorEmail ?? entry.actorId} - {formatAuditTimestamp(entry, locale, t(`${copy}.pendingTimestamp`))}
                {" - "}{t(`${copy}.target`)}{" "}
                {entry.targetId}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
