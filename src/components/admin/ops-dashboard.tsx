"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

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
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import {
  subscribeToAuditLog,
  type AuditLogEntry,
} from "@/lib/data/audit-log";

// Oito filas, cada uma com endereço próprio (?tab=). "Access" é a oitava:
// papéis e "ver como" moravam no fim da página, fora das abas — dois modelos
// de navegação na mesma tela.
const opsTabValues = [
  "verification",
  "catalog",
  "payments",
  "community",
  "support",
  "users",
  "audit",
  "access",
] as const;

type OpsTab = (typeof opsTabValues)[number];

function isOpsTab(value: string | null): value is OpsTab {
  return (opsTabValues as readonly string[]).includes(value ?? "");
}

export function OpsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: OpsTab = isOpsTab(requestedTab) ? requestedTab : "verification";
  const counts = useOpsQueueCounts();

  // Os três cartões de métrica que ficavam entre as abas e o conteúdo viraram
  // estes contadores, ao lado do nome da fila. Enquanto carrega, sem número —
  // um "0" que depois vira "3" é pior que nada.
  const badge = (value: number) => (counts.isLoading ? undefined : value);
  const opsTabs = [
    { value: "verification", label: "Creator verification", count: badge(counts.pendingVerifications) },
    { value: "catalog", label: "Published catalog" },
    { value: "payments", label: "Payments" },
    { value: "community", label: "Community reports", count: badge(counts.openReports) },
    { value: "support", label: "Support tickets", count: badge(counts.openTickets) },
    { value: "users", label: "Users" },
    { value: "audit", label: "Audit log" },
    { value: "access", label: "Access" },
  ];

  // Os filtros Período e Status saíram: nenhuma das sete filas lia esses
  // parâmetros (grep em todos os painéis: zero leituras). Eram dois seletores
  // decorativos entre a aba e a fila. Quando uma fila ganhar filtro de verdade,
  // ele nasce dentro dela, na linha do título.
  function selectTab(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);

    startTransition(() => {
      router.replace(`/ops?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white px-5 pt-2 shadow-[var(--shadow-soft)]">
        <HorizontalTabs
          tabs={opsTabs}
          activeValue={activeTab}
          onChange={selectTab}
          ariaLabel="Operations queues"
          className="border-b-0"
        />
      </section>

      {activeTab === "access" ? (
        <section className="grid gap-5">
          <h2 className="text-base font-bold text-[var(--color-ink)]">
            Access levels
          </h2>
          <ViewAsSwitcher />
          <RoleManager />
        </section>
      ) : activeTab === "verification" ? (
        <CreatorVerificationQueue />
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
        <SupportTicketQueue />
      ) : activeTab === "users" ? (
        <>
          <UserLookupPanel />
          <AccountActionRequestsPanel />
        </>
      ) : activeTab === "audit" ? (
        <AuditLogPanel />
      ) : null}
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
