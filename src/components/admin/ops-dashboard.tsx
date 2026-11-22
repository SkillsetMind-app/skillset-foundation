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
  // O selo de "Users" conta estes pedidos; com algum aberto, eles vêm antes da
  // lista de 50 pessoas em vez de ficarem embaixo dela (I-01). A ordem é
  // decidida UMA vez, quando a contagem chega: mudar depois moveria o nó da
  // tabela no DOM, e um <dialog> aberto lá dentro sairia da camada do topo
  // (perde fundo, foco preso e Esc). Mesmo padrão de estado derivado no render
  // de ops-overview-metrics.tsx, sem setState em efeito.
  const [privacyFirst, setPrivacyFirst] = useState<boolean | null>(null);
  if (privacyFirst === null && counts.openPrivacyRequests !== "loading") {
    setPrivacyFirst(typeof counts.openPrivacyRequests === "number" && counts.openPrivacyRequests > 0);
  }

  return (
    <PlatformShell
      // O título é a fila aberta; "Operations" em todas as nove abas não dizia onde se está (I-07).
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
      {/* ops-surface: escopo das regras de CSS só do /ops (globals.css). */}
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
            {/* Enquanto a contagem carrega, só a tabela: o painel de pedidos entra
                depois, acima ou abaixo, sem mover a tabela (ela nunca muda de lugar). */}
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
      {/* O título da página já diz "Audit log" (I-07); aqui fica só a explicação e a lista. */}
      <p className="max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
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
          // h2: logo abaixo do h1 "Audit log", sem outro título no meio.
          <EmptyState as="h2" title={t(`${copy}.empty`)} />
        ) : (
          entries.map((entry) => (
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
              {/* Quando, quem e o alvo em partes com rótulo, não numa frase só (I-06). */}
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
          ))
        )}
      </div>
    </section>
  );
}
