"use client";

import { useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { formatCourseAssetSize, getCourseAssetUploadErrorMessage } from "@/domain/course-asset";
import { landingImageMaxBytes, landingImageTypes, uploadLandingImage } from "@/lib/data/landing-images";

import { ImageUploadField } from "./image-upload-field";

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
  // Size of the file being uploaded (null = nothing uploading): the progress note, the
  // same as on the builder covers, says "Sending..." and the size, because this
  // upload does not report a percentage.
  const [uploadingBytes, setUploadingBytes] = useState<number | null>(null);
  const uploading = uploadingBytes !== null;
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
    setUploadingBytes(file.size);
    try {
      onChange(await uploadLandingImage(courseId, file));
    } catch (cause) {
      setError(getCourseAssetUploadErrorMessage(cause, landingImageMaxBytes, t));
    } finally {
      setUploadingBytes(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    // The group carries the block's name: with two images on the page, each "Or paste
    // a link" says which image it is for.
    <div role="group" aria-label={label} className="grid gap-3">
      {/* The image shell of the builder covers (B-05): 200px preview,
          fixed-label button, upload note, error and "Remove". */}
      <ImageUploadField
        title={label}
        help={t("teacherLanding.upload.rules").replace("{limit}", () => limit)}
        preview={{ src: value, alt: t("teacherLanding.upload.previewAlt").replace("{label}", () => label) }}
        triggerLabel={t("teacherLanding.upload.button")}
        input={{
          ref: inputRef,
          accept: landingImageTypes.join(","),
          disabled: uploading,
          onChange: (e) => void handleFile(e.target.files?.[0]),
        }}
        remove={{ label: t("teacherLanding.upload.remove"), onClick: () => onChange(null) }}
        progress={uploadingBytes === null ? null : { bytesTransferred: 0, totalBytes: uploadingBytes, percent: null, state: "running" }}
        error={error || undefined}
      />
      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        {t("teacherLanding.upload.orLink")}
        <input
          className="field-input"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.trim() || null)}
        />
      </label>
    </div>
  );
}
