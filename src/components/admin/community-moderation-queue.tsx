"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { InlineAlert } from "@/components/ui";
import type { CommunityReport, CommunityReportStatus } from "@/domain/community-report";
import { communityReportReasonLabels } from "@/domain/community-report";
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
  const { t } = useTranslation();
  const copy = "platform.ops.communityPanel";
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [ready, setReady] = useState(!hasBackendConfig);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!hasBackendConfig) {
      return;
    }

    return subscribeToCommunityReports(
      (nextReports) => {
        setReports(nextReports);
        setLoadError(false);
        setReady(true);
      },
      () => {
        setLoadError(true);
        setReady(true);
      },
    );
  }, [hasBackendConfig]);

  async function handleStatusChange(
    report: CommunityReport,
    status: CommunityReportStatus,
  ) {
    setActiveReportId(report.id);
    setError(false);

    try {
      await updateCommunityReportStatus(report, status);
    } catch {
      setError(true);
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
            {t(`${copy}.eyebrow`)}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        {hasBackendConfig && ready && !loadError ? <span className="rounded-[10px] bg-[var(--color-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--color-primary)]">{t(`${copy}.${openReports.length === 1 ? "countOne" : "count"}`).replace("{count}", () => String(openReports.length))}</span> : null}
      </div>

      {loadError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert> : null}
      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.updateError`)}</InlineAlert> : null}

      {!hasBackendConfig ? (
        <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.configurationRequired`)}
        </p>
      ) : !ready ? (
        <p role="status" className="mt-5 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.loading`)}
        </p>
      ) : reports.length === 0 ? (
        loadError ? null : <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
      ) : (
        <div className="mt-5 grid gap-3">
          {reports.slice(0, 12).map((report) => (
            <article
              key={report.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-[var(--color-ink)]">
                    {Object.hasOwn(communityReportReasonLabels, report.reason) ? t(`${copy}.reasons.${report.reason}`) : report.reason.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {t(`${copy}.targets.${report.targetType}`)} {t(`${copy}.in`)} {report.courseSlug}
                  </p>
                </div>
                <StatusChip status={report.status} />
              </div>
              <div className="mt-3 grid gap-2 break-words text-sm leading-6 text-[var(--color-ink-soft)]">
                <p>
                  {t(`${copy}.author`)}{" "}
                  <strong className="text-[var(--color-ink)]">
                    {report.targetAuthorName}
                  </strong>
                </p>
                <p>
                  {t(`${copy}.reporter`)}{" "}
                  <strong className="text-[var(--color-ink)]">
                    {report.reporterName}
                  </strong>
                </p>
                {report.detail ? <p>{t(`${copy}.context`)} {report.detail}</p> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {reviewStatuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={activeReportId === report.id}
                    onClick={() => handleStatusChange(report, status)}
                    className="button-outline min-h-11 px-3 py-2 text-xs disabled:opacity-60"
                  >
                    {activeReportId === report.id
                      ? t(`${copy}.saving`)
                      : t(`statusChip.${status}`)}
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
