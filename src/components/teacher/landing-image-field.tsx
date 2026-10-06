"use client";

import { Loader2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
  supabaseUploadLimitBytes,
} from "@/domain/course-asset";
import { fetchCourseAssets, uploadCourseAsset } from "@/lib/data/course-assets";

const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

const fieldClass =
  "w-full rounded-none border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm text-[var(--color-ink)]";

/**
 * Image field for sales page blocks. Reuses the course asset upload (public-media
 * bucket, course-owned path). `lesson_thumbnail` without a lesson is inert in the
 * classroom, so the file never replaces the course cover. The URL field stays as
 * the secondary option.
 */
export function LandingImageField({
  courseId,
  ownerId,
  label,
  value,
  placeholder,
  onChange,
}: {
  courseId: string;
  ownerId: string;
  label: string;
  value: string | null;
  placeholder?: string;
  onChange: (url: string | null) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const limit = formatCourseAssetSize(supabaseUploadLimitBytes);
  const rules = t("teacherLanding.upload.rules").replace("{limit}", () => limit);

  async function handleFile(file: File | undefined) {
    if (!file || uploading) return;
    setError("");
    if (!allowedTypes.includes(file.type)) {
      setError(rules);
      return;
    }
    setUploading(true);
    try {
      const assetId = await uploadCourseAsset({
        courseId,
        ownerId,
        kind: "lesson_thumbnail",
        file,
        isPreview: false,
        lessonId: null,
        moduleId: null,
      });
      const asset = (await fetchCourseAssets(courseId)).find((a) => a.id === assetId);
      if (!asset?.downloadUrl) throw new Error("missing url");
      onChange(asset.downloadUrl);
    } catch (cause) {
      setError(getCourseAssetUploadErrorMessage(cause, supabaseUploadLimitBytes, t));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">{label}</span>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={t("teacherLanding.upload.previewAlt").replace("{label}", () => label)}
          className="max-h-40 w-full rounded-none border border-[var(--color-line)] object-cover"
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex w-fit items-center gap-2 rounded-none border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-60"
      >
        {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UploadCloud className="size-4" aria-hidden />}
        {uploading ? t("teacherLanding.upload.uploading") : t("teacherLanding.upload.button")}
      </button>
      <p className="text-xs normal-case tracking-normal text-[var(--color-ink-soft)]">{rules}</p>
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
          onChange={(e) => onChange(e.target.value || null)}
        />
      </label>
    </div>
  );
}
