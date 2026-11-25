"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { Button, InlineAlert } from "@/components/ui";
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
const PAGE = 12;

export function CommunityModerationQueue() {
  const { t } = useTranslation();
  const copy = "platform.ops.communityPanel";
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [ready, setReady] = useState(!hasBackendConfig);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  // Which status was pressed: only it spins; the others only lock (I-08).
  const [activeStatus, setActiveStatus] = useState<CommunityReportStatus | null>(null);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Open first, but each report's group is decided ONCE, when
  // it first appears. Reordering on every read moved the cards
  // under the pointer: with A dismissed, B moved up into its place and the 2nd click
  // "just to be sure" dismissed B (I-09). That way only a new report changes the
  // order, as it already did before.
  const [groups, setGroups] = useState<Record<string, 0 | 1>>({});
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!hasBackendConfig) {
      return;
    }

    return subscribeToCommunityReports(
      (nextReports) => {
        setReports(nextReports);
        setGroups((current) => {
          const unseen = nextReports.filter((report) => !(report.id in current));
          if (unseen.length === 0) return current;
          return { ...current, ...Object.fromEntries(unseen.map((report) => [report.id, report.status === "open" ? 0 : 1])) };
        });
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
    setActiveStatus(status);
    setError(false);

    try {
      await updateCommunityReportStatus(report, status);
    } catch {
      setError(true);
    } finally {
      setActiveReportId(null);
      setActiveStatus(null);
    }
  }

  const openReports = reports.filter((report) => report.status === "open");
  // In steps of 12: before the list stopped at the 12th with no notice, while the badge
  // counted all the open ones. The sort is stable: within the group, arrival order.
  const ordered = [...reports].sort((a, b) => (groups[a.id] ?? 1) - (groups[b.id] ?? 1));
  const hidden = ordered.length - shown;

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        {hasBackendConfig && ready && !loadError ? <span className="rounded-md bg-[var(--color-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--color-primary)]">{t(`${copy}.${openReports.length === 1 ? "countOne" : "count"}`).replace("{count}", () => String(openReports.length))}</span> : null}
      </div>

      {loadError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert> : null}
      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.updateError`)}</InlineAlert> : null}

      {!hasBackendConfig ? (
        <p className="mt-5 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.configurationRequired`)}
        </p>
      ) : !ready ? (
        <p role="status" className="mt-5 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.loading`)}
        </p>
      ) : reports.length === 0 ? (
        loadError ? null : <p className="mt-5 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
      ) : (
        <div className="mt-5 grid gap-3">
          {ordered.slice(0, shown).map((report) => (
            <article
              key={report.id}
              className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
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
              {/* Each button always stays in the same place, with the same meaning; the current
                  status one only locks. Moving the button after an
                  action made the 2nd click land on another decision (I-09). */}
              <div role="group" aria-labelledby={`report-move-${report.id}`} className="mt-4 flex flex-wrap items-center gap-2">
                <span id={`report-move-${report.id}`} className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t(`${copy}.moveTo`)}
                </span>
                {reviewStatuses.map((status) => (
                  <Button
                    key={status}
                    variant="outline"
                    size="sm"
                    disabled={activeReportId === report.id || report.status === status}
                    loading={activeReportId === report.id && activeStatus === status}
                    busyLabel={t(`statusChip.${status}`)}
                    onClick={() => handleStatusChange(report, status)}
                    className="min-h-11 px-3 py-2"
                  >
                    {t(`statusChip.${status}`)}
                  </Button>
                ))}
              </div>
            </article>
          ))}
          {hidden > 0 ? (
            <Button variant="outline" className="w-fit" onClick={() => setShown((count) => count + PAGE)}>
              {t(`${copy}.showMore`).replace("{count}", () => String(Math.min(PAGE, hidden)))}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
