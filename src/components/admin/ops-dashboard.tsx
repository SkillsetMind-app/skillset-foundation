"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountActionRequestsPanel } from "@/components/admin/account-action-requests-panel";
import { AdminEnrollmentPanel } from "@/components/admin/admin-enrollment-panel";
import { formatAuditAction, formatAuditTarget } from "@/components/admin/audit-labels";
import { CommunityModerationQueue } from "@/components/admin/community-moderation-queue";
import { CreatorVerificationQueue } from "@/components/admin/creator-verification-queue";
import { ManagedCoursePanel } from "@/components/admin/managed-course-panel";
import { useOpsQueueCounts } from "@/components/admin/ops-overview-metrics";
import { OpsOverviewPanel } from "@/components/admin/ops-overview-panel";
import { OpsUserTable } from "@/components/admin/ops-user-table";
import { PaymentOperationsPanel } from "@/components/admin/payment-operations-panel";
import { RoleManager } from "@/components/admin/role-manager";
import { SupportTicketQueue } from "@/components/admin/support-ticket-queue";
import { ViewAsSwitcher } from "@/components/admin/view-as";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformShell } from "@/components/platform/platform-shell";
import { EmptyState, InlineAlert } from "@/components/ui";
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
  const currentItem = getOpsNavItem(searchParams.get("tab"), user);
  const activeTab = currentItem.tab;
  const canOpenQueue = canAccessPlatformNavItem(user, currentItem);
  const counts = useOpsQueueCounts();
  const query = searchParams.get("q") ?? "";
  const queueSearchParams = new URLSearchParams(searchParams.toString());
  queueSearchParams.set("tab", activeTab);
  const searchHref = canOpenQueue && (activeTab === "verification" || activeTab === "support")
    ? `/ops?${queueSearchParams.toString()}`
    : null;
  // The "Users" badge counts these requests; with any open, they come before the
  // list of 50 people instead of staying below it (I-01). The order is
  // decided ONCE, when the count arrives: changing it later would move the table
  // node in the DOM, and an open <dialog> inside it would leave the top layer
  // (loses backdrop, trapped focus and Esc). Same pattern of state derived on render
  // as ops-overview-metrics.tsx, with no setState in an effect.
  const [privacyFirst, setPrivacyFirst] = useState<boolean | null>(null);
  if (privacyFirst === null && counts.openPrivacyRequests !== "loading") {
    setPrivacyFirst(typeof counts.openPrivacyRequests === "number" && counts.openPrivacyRequests > 0);
  }

  return (
    <PlatformShell
      // The title is the open queue; "Operations" on all nine tabs did not say where you are (I-07).
      eyebrow={t("platform.nav.operations")}
      title={t(currentItem.labelKey)}
      compact
      currentNavigationHref={currentItem.href}
      searchHref={searchHref}
      navigationCounts={{
        [getOpsNavItem("verification").href]: counts.pendingVerifications,
        [getOpsNavItem("community").href]: counts.openReports,
        [getOpsNavItem("support").href]: counts.openTickets,
        [getOpsNavItem("users").href]: counts.openPrivacyRequests,
      }}
    >
      {/* ops-surface: scope of the CSS rules for /ops only (globals.css). */}
      <div className="ops-surface grid min-w-0 gap-5">
        {!canOpenQueue ? (
          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-6">
            <p role="alert" className="text-sm text-[var(--color-ink)]">
              {t("platform.ops.unavailable")}
            </p>
            <Link
              href="/ops"
              className="mt-4 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4"
            >
              {t("platform.ops.back")}
            </Link>
          </section>
        ) : activeTab === "overview" ? (
          <OpsOverviewPanel counts={counts} />
        ) : activeTab === "access" ? (
          <section className="grid min-w-0 grid-cols-1 gap-5">
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
            {/* While the count loads, only the table; the requests panel comes in
                later, above or below, without moving the table (it never changes place). */}
            {privacyFirst === true ? <AccountActionRequestsPanel key="requests" /> : null}
            <OpsUserTable key="users" />
            {privacyFirst === false ? <AccountActionRequestsPanel key="requests" /> : null}
          </>
        ) : activeTab === "audit" ? (
          <AuditLogPanel />
        ) : null}
      </div>
    </PlatformShell>
  );
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
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      {/* The page title already says "Audit log" (I-07); here only the explanation and the list remain. */}
      <p className="max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t(`${copy}.description`)}
      </p>

      {/* Wide card: one table, with when, who and the target in columns (I-06).
          Narrow card: one block per event, as in sale-list.tsx (#588). */}
      <div className="@container mt-5">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.loading`)}
          </p>
        ) : error ? (
          <InlineAlert tone="error">{t(`${copy}.loadError`)}</InlineAlert>
        ) : entries.length === 0 ? (
          // h2: right below the h1 "Audit log", with no other title in between.
          <EmptyState as="h2" title={t(`${copy}.empty`)} />
        ) : (
          <>
          <div className="grid gap-3 @3xl:hidden">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--color-ink)]">
                    {formatAuditAction(entry.action, t)}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                    {entry.summary}
                  </p>
                </div>
                <span className="rounded-chip bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {formatAuditTarget(entry.targetType, t)}
                </span>
              </div>
              {/* When, who and the target as labeled parts, not in a single sentence (I-06). */}
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                <div className="flex gap-1.5">
                  <dt>{t(`${copy}.when`)}</dt>
                  <dd className="tabular-nums text-[var(--color-ink)]">{formatAuditTimestamp(entry, locale, t(`${copy}.pendingTimestamp`))}</dd>
                </div>
                <div className="flex min-w-0 gap-1.5">
                  <dt>{t(`${copy}.actor`)}</dt>
                  <dd className="min-w-0 break-all text-[var(--color-ink)]">{entry.actorEmail ?? entry.actorId}</dd>
                </div>
                <div className="flex min-w-0 gap-1.5">
                  <dt>{t(`${copy}.target`)}</dt>
                  <dd className="min-w-0 break-all font-mono text-[var(--color-ink)]">{entry.targetId}</dd>
                </div>
              </dl>
            </article>
          ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-line)] @3xl:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">{t(`${copy}.tableCaption`)}</caption>
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  {(["when", "action", "actor", "target"] as const).map((head) => (
                    <th key={head} scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                      {t(`${copy}.${head}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--color-line)] align-top last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-[var(--color-ink)]">
                      {formatAuditTimestamp(entry, locale, t(`${copy}.pendingTimestamp`))}
                    </td>
                    <th scope="row" className="max-w-[22rem] px-4 py-3 font-semibold text-[var(--color-ink)]">
                      {formatAuditAction(entry.action, t)}
                      <span className="mt-1 block break-words text-xs font-normal leading-5 text-[var(--color-ink-soft)]">{entry.summary}</span>
                    </th>
                    <td className="max-w-[16rem] break-all px-4 py-3 text-xs text-[var(--color-ink)]">{entry.actorEmail ?? entry.actorId}</td>
                    <td className="max-w-[16rem] px-4 py-3 text-xs">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">{formatAuditTarget(entry.targetType, t)}</span>
                      <span className="mt-1 block select-all break-all font-mono text-[var(--color-ink)]">{entry.targetId}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </section>
  );
}
