"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ProgressBar } from "@/components/ui/progress-bar";
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
          {/* A barra da casa (ui/progress-bar), a mesma do <progress> de envio
              (.upload-progress): 6px, trilho --color-line, latão de texto. Era
              8px navy, com a largura animada até para quem pediu menos movimento. */}
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
        // F-20: sem porcentagem a nota ficava parada e parecia travada. A
        // barra indeterminada mostra que segue andando, sem inventar número.
        <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
          {/* Largura e movimento vêm do globals.css (bloco F-20): 30% deslizando,
              ou o trilho inteiro apagado com "reduzir movimento". */}
          <div className="upload-indeterminate-fill h-full rounded-full bg-[var(--color-accent-fg)]" />
        </div>
      ) : null}
    </div>
  );
}
