"use client";

import { useEffect, useState } from "react";

import { StatusChip } from "@/components/shared/status-chip";
import type { CommunityReport, CommunityReportStatus } from "@/domain/community-report";
import {
  communityReportReasonLabels,
  communityReportStatusLabels,
} from "@/domain/community-report";
import {
  subscribeToCommunityReports,
  updateCommunityReportStatus,
} from "@/lib/data/community-posts";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

const reviewStatuses: CommunityReportStatus[] = [
  "reviewed",
  "resolved",
  "dismissed",
];

export function CommunityModerationQueue() {
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [ready, setReady] = useState(!hasBackendConfig);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasBackendConfig) {
      return;
    }

    return subscribeToCommunityReports(
      (nextReports) => {
        setReports(nextReports);
        setReady(true);
      },
      () => {
        setError("We could not load community reports.");
        setReady(true);
      },
    );
  }, [hasBackendConfig]);

  async function handleStatusChange(
    report: CommunityReport,
    status: CommunityReportStatus,
  ) {
    setActiveReportId(report.id);
    setError("");

    try {
      await updateCommunityReportStatus(report, status);
    } catch {
      setError("We could not update this report status.");
    } finally {
      setActiveReportId(null);
    }
  }

  const openReports = reports.filter((report) => report.status === "open");

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Community moderation
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            Trust reports
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Review reports from course communities and close the loop.
          </p>
        </div>
        <span className="rounded-[10px] bg-[var(--color-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--color-primary)]">
          {openReports.length} open
        </span>
      </div>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      {!hasBackendConfig ? (
        <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
          Backend configuration is required before community reports can load.
        </p>
      ) : !ready ? (
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          Loading community reports...
        </p>
      ) : reports.length === 0 ? (
        <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
          No community reports yet.
        </p>
      ) : (
        <div className="mt-5 grid gap-3">
          {reports.slice(0, 12).map((report) => (
            <article
              key={report.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {communityReportReasonLabels[report.reason]}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {report.targetType} in {report.courseSlug}
                  </p>
                </div>
                <StatusChip
                  status={report.status}
                  label={communityReportStatusLabels[report.status]}
                />
              </div>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                <p>
                  Reported content author:{" "}
                  <strong className="text-[var(--color-ink)]">
                    {report.targetAuthorName}
                  </strong>
                </p>
                <p>
                  Reporter:{" "}
                  <strong className="text-[var(--color-ink)]">
                    {report.reporterName}
                  </strong>
                </p>
                {report.detail ? <p>Context: {report.detail}</p> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {reviewStatuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={activeReportId === report.id}
                    onClick={() => handleStatusChange(report, status)}
                    className="button-outline px-3 py-2 text-xs disabled:opacity-60"
                  >
                    {activeReportId === report.id
                      ? "Saving..."
                      : communityReportStatusLabels[status]}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
