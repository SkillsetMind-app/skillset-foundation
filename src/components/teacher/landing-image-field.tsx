"use client";

import { Loader2, UploadCloud, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { formatCourseAssetSize, getCourseAssetUploadErrorMessage } from "@/domain/course-asset";
import { landingImageMaxBytes, landingImageTypes, uploadLandingImage } from "@/lib/data/landing-images";

const fieldClass =
  "w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm text-[var(--color-ink)]";

/**
 * Image field for sales page blocks: upload first, pasting a link second.
 *
 * `onChange` can run long after the click, once the upload finishes; by then
 * the creator may have typed, moved or removed the section. The caller must
 * apply it to its latest state by a stable block id, never to a block object
 * or index captured at render time.
 */
export function LandingImageField({
  courseId,
  label,
  value,
  placeholder,
  onChange,
}: {
  courseId: string;
  label: string;
  value: string | null;
  placeholder?: string;
  onChange: (url: string | null) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const rulesId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const limit = formatCourseAssetSize(landingImageMaxBytes);

  async function handleFile(file: File | undefined) {
    if (!file || uploading) return;
    setError("");
    if (!landingImageTypes.includes(file.type)) {
      setError(t("teacherLanding.upload.wrongType"));
      return;
    }
    if (file.size > landingImageMaxBytes) {
      setError(
        t("teacherLanding.upload.tooLarge").replace(/\{size\}|\{limit\}/g, (token) =>
          token === "{size}" ? formatCourseAssetSize(file.size) : limit,
        ),
      );
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadLandingImage(courseId, file));
    } catch (cause) {
      setError(getCourseAssetUploadErrorMessage(cause, landingImageMaxBytes, t));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div role="group" aria-labelledby={labelId} className="grid gap-2">
      <span id={labelId} className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
        {label}
      </span>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={t("teacherLanding.upload.previewAlt").replace("{label}", () => label)}
          className="max-h-40 w-full rounded-md border border-[var(--color-line)] object-cover"
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={landingImageTypes.join(",")}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={uploading}
          aria-describedby={rulesId}
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UploadCloud className="size-4" aria-hidden />}
          {uploading ? t("teacherLanding.upload.uploading") : t("teacherLanding.upload.button")}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--color-danger-fg)]"
          >
            <X className="size-4" aria-hidden />
            {t("teacherLanding.upload.remove")}
          </button>
        ) : null}
      </div>
      <p id={rulesId} className="text-xs normal-case tracking-normal text-[var(--color-ink-soft)]">
        {t("teacherLanding.upload.rules").replace("{limit}", () => limit)}
      </p>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
        {t("teacherLanding.upload.orLink")}
        <input
          className={fieldClass}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.trim() || null)}
        />
      </label>
    </div>
  );
}
