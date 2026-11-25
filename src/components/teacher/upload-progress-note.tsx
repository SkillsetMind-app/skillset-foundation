"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatCourseAssetSize } from "@/domain/course-asset";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";

// A single reading of progress for the uploads panel and the builder's cover
// fields. When the transport does not report a percentage (Supabase Storage),
// it says it is uploading and the size — never a bar stuck at 0% that read
// as "stuck".
export function UploadProgressNote({
  progress,
}: {
  progress: UploadCourseAssetProgress;
}) {
  const { t } = useTranslation();
  const { percent } = progress;
  const done = progress.state === "success";

  return (
    <div
      role="status"
      className="rounded-md border fine-rule bg-white p-3"
    >
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--color-primary)]">
        <span>{t(`courseMedia.upload.${done ? "complete" : percent === null ? "sending" : "uploading"}`)}</span>
        <span>
          {percent === null
            ? formatCourseAssetSize(progress.totalBytes)
            : `${percent}%`}
        </span>
      </div>
      {percent !== null ? (
        <>
          {/* The house bar (ui/progress-bar), the same as the upload <progress>
              (.upload-progress): 6px, --color-line track, brass text color. It was
              8px navy, with the width animated even for whoever asked for less motion. */}
          <ProgressBar
            value={percent}
            label={t(`courseMedia.upload.${done ? "complete" : "uploading"}`)}
            className="mt-2"
          />
          <p className="mt-2 text-[11px] text-[var(--color-ink-soft)]">
            {t("courseMedia.upload.transferred")
              .replace("{transferred}", () => formatCourseAssetSize(progress.bytesTransferred))
              .replace("{total}", () => formatCourseAssetSize(progress.totalBytes))}
          </p>
        </>
      ) : !done ? (
        // F-20: with no percentage the note sat still and looked stuck. The
        // indeterminate bar shows it is still moving, without inventing a number.
        <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
          {/* Width and motion come from globals.css (F-20 block): 30% sliding,
              or the whole track dimmed with "reduce motion". */}
          <div className="upload-indeterminate-fill h-full rounded-full bg-[var(--color-accent-fg)]" />
        </div>
      ) : null}
    </div>
  );
}
