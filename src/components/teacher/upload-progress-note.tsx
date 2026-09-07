"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { formatCourseAssetSize } from "@/domain/course-asset";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";

// Uma só leitura do progresso para o painel de uploads e os campos de capa do
// builder. Quando o transporte não informa porcentagem (Supabase Storage),
// diz que está enviando e o tamanho — nunca uma barra parada em 0% que se lia
// como "travou".
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
      className="rounded-[10px] border fine-rule bg-white p-3"
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
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-ink-soft)]">
            {t("courseMedia.upload.transferred")
              .replace("{transferred}", () => formatCourseAssetSize(progress.bytesTransferred))
              .replace("{total}", () => formatCourseAssetSize(progress.totalBytes))}
          </p>
        </>
      ) : null}
    </div>
  );
}
