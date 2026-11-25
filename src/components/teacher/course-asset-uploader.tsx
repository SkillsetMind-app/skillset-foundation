"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel, Button, ConfirmDialog, InlineAlert } from "@/components/ui";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";
import {
  courseAssetAcceptTypes,
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
  isAllowedCourseAssetFile,
  supabaseUploadLimitBytes,
} from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  deleteCourseAsset,
  subscribeToCourseAssets,
  uploadCourseAsset,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";
import { compressImage, MAX_SOURCE_IMAGE_BYTES } from "@/lib/media/compress-image";

import { UploadProgressNote } from "./upload-progress-note";

const assetKinds: CourseAssetKind[] = ["course_cover", "module_cover"];

const moduleTargetKinds: CourseAssetKind[] = ["module_cover"];

const uploadPresets: Array<{
  kind: CourseAssetKind;
  detail: string;
}> = [
  {
    kind: "module_cover",
    // The proportion is that of the module poster (2/3, object-cover):
    // without saying so here the teacher only found out the framing in the learner area.
    detail: "creatorEditor.assets.presets.module",
  },
  {
    kind: "course_cover",
    detail: "creatorEditor.assets.presets.course",
  },
];

type CourseAssetUploaderProps = {
  course: TeacherCourse;
  isEditable: boolean;
  onModuleCoverUploaded?: (moduleId: string, assetId: string) => void;
  onAssetDeleted?: () => void;
};

export function CourseAssetUploader({ course, isEditable, onModuleCoverUploaded, onAssetDeleted }: CourseAssetUploaderProps) {
  const { locale, t } = useTranslation();
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const [kind, setKind] = useState<CourseAssetKind>("course_cover");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [moduleId, setModuleId] = useState("");
  const [isPreview, setIsPreview] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState<
    | { kind: "load" | "module" | "delete" | "tooLarge" }
    | { kind: "invalidFile"; assetKind: CourseAssetKind }
    | { kind: "upload"; cause: unknown }
    | null
  >(null);
  const [success, setSuccess] = useState<"uploaded" | "deleted" | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  // File that asked to be deleted, while the question is open.
  const [askingAsset, setAskingAsset] = useState<CourseAsset | null>(null);
  const allLessons = course.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: module.title,
    })),
  );
  const allModules = course.modules.map((module) => ({
    id: module.id,
    title: module.title,
  }));
  const requiresModuleTarget = moduleTargetKinds.includes(kind);
  const courseLevelAssets = assets.filter((asset) => !asset.lessonId && !asset.moduleId);
  const moduleAssets = assets.filter((asset) => asset.moduleId);
  const lessonAssets = assets.filter((asset) => asset.lessonId);
  const activePreset = uploadPresets.find((preset) => preset.kind === kind);
  const kindLabel = getCourseAssetKindLabel(kind, t);
  const errorMessage = !error ? null : error.kind === "upload"
    ? getCourseAssetUploadErrorMessage(error.cause, supabaseUploadLimitBytes, t)
    : error.kind === "invalidFile"
      ? t("creatorEditor.assets.errors.invalidFile")
        .replace("{kind}", () => getCourseAssetKindLabel(error.assetKind, t).toLocaleLowerCase(locale))
        .replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))
      : error.kind === "tooLarge"
        ? t("creatorEditor.members.coverTooLarge")
        : t(`creatorEditor.assets.errors.${error.kind}`);

  // Preview of the chosen file before uploading. Both presets in this panel
  // are images; without this the teacher uploaded the module cover blind.
  const previewUrl = useMemo(
    () =>
      selectedFile?.type.startsWith("image/")
        ? URL.createObjectURL(selectedFile)
        : "",
    [selectedFile],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // course_assets is not in the Realtime publication: after uploading or
  // deleting, the list fetches again instead of waiting for an event that never comes.
  const assetsReloadRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const subscription = subscribeToCourseAssets(
      course.id,
      setAssets,
      () => setError({ kind: "load" }),
    );
    assetsReloadRef.current = subscription.reload;
    return () => {
      assetsReloadRef.current = null;
      subscription();
    };
  }, [course.id]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable || !selectedFile || isUploading) {
      return;
    }

    setError(null);
    setSuccess(null);
    setUploadProgress(null);

    if (!isAllowedCourseAssetFile(selectedFile, kind)) {
      setError({ kind: "invalidFile", assetKind: kind });
      return;
    }

    // Module cover: same 10 MB cap as the module page field.
    if (kind === "module_cover" && selectedFile.size > MAX_SOURCE_IMAGE_BYTES) {
      setError({ kind: "tooLarge" });
      return;
    }

    if (requiresModuleTarget && !moduleId) {
      setError({ kind: "module" });
      return;
    }

    setIsUploading(true);

    try {
      // Same 2:3 crop and compression as the module page field; if it fails,
      // it uploads the original.
      const file = kind === "module_cover"
        ? await compressImage(selectedFile).catch(() => selectedFile)
        : selectedFile;
      const assetId = await uploadCourseAsset({
        courseId: course.id,
        ownerId: course.ownerId,
        kind,
        file,
        isPreview,
        lessonId: null,
        moduleId: requiresModuleTarget ? moduleId : null,
        onProgress: setUploadProgress,
      });
      if (kind === "module_cover") onModuleCoverUploaded?.(moduleId, assetId);
      void assetsReloadRef.current?.();
      setSuccess("uploaded");
      setSelectedFile(null);
      setModuleId("");
      setIsPreview(false);
      setUploadProgress(null);
      setFileInputKey((current) => current + 1);
    } catch (uploadError) {
      // The real reason (size cap, permission, connection) already comes ready from the
      // domain; the generic text blamed "permissions" for a size 413.
      setUploadProgress(null);
      setError({ kind: "upload", cause: uploadError });
    } finally {
      setIsUploading(false);
    }
  }

  // Runs only through the dialog's confirm, which used to be the OK of window.confirm.
  async function handleDeleteAsset(asset: CourseAsset) {
    if (!isEditable) {
      return;
    }

    setError(null);
    setSuccess(null);
    setDeletingAssetId(asset.id);

    try {
      await deleteCourseAsset(asset);
      void assetsReloadRef.current?.();
      onAssetDeleted?.();
      setSuccess("deleted");
    } catch {
      setError({ kind: "delete" });
    } finally {
      setDeletingAssetId(null);
    }
  }

  return (
    <section className="course-upload-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("creatorEditor.assets.label")}
          </p>
          {/* Section title in the app's style, not a 30px display: the library is a
              tool under the builder, not the subject of the page. */}
          <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
            {t("creatorEditor.assets.title")}
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.assets.help")}
          </p>
        </div>
        <span className="rounded-chip border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {t("creatorEditor.assets.count").replace("{count}", () => String(assets.length))}
        </span>
      </div>
      {course.coverImageUrl ? (
        <p className="mt-4 rounded-md border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          {t("creatorEditor.assets.coverSet")}
        </p>
      ) : null}

      <form className="mt-5 grid gap-3" onSubmit={handleUpload}>
        {/* One row: type, module (for the module cover) and file. Before
            there were two type cards, an "UPLOADING" box that uploaded
            nothing, the same type again in a select and the native file input stretched,
            one under the other. The fields and the upload are the same. */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            {t("creatorEditor.assets.assetType")}
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as CourseAssetKind);
                setSelectedFile(null);
                setModuleId("");
                setUploadProgress(null);
                setFileInputKey((current) => current + 1);
              }}
              disabled={!isEditable || isUploading}
              className="field-input field-input--inline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {assetKinds.map((item) => (
                <option key={item} value={item}>
                  {getCourseAssetKindLabel(item, t)}
                </option>
              ))}
            </select>
          </label>

          {requiresModuleTarget ? (
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.assets.attachModule")}
              <select
                value={moduleId}
                onChange={(event) => setModuleId(event.target.value)}
                disabled={!isEditable || isUploading || allModules.length === 0}
                className="field-input field-input--inline disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {allModules.length === 0 ? t("creatorEditor.assets.addModules") : t("creatorEditor.assets.chooseModule")}
                </option>
                {allModules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <input
            key={fileInputKey}
            type="file"
            accept={courseAssetAcceptTypes[kind]}
            aria-label={t("creatorEditor.assets.chooseFile").replace("{kind}", () => locale === "en" ? kindLabel.toLowerCase() : kindLabel)}
            disabled={!isEditable || isUploading}
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] ?? null);
              setUploadProgress(null);
            }}
            className="min-h-11 min-w-0 flex-1 basis-56 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[var(--color-primary)] disabled:opacity-60"
          />
        </div>

        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
          {activePreset ? t(activePreset.detail) : t("creatorEditor.assets.targetHelp")}{" "}
          {t("creatorEditor.assets.imageLimit").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))}
        </p>

        <label className="flex items-start gap-3 rounded-md border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={isPreview}
            disabled={!isEditable || isUploading}
            onChange={(event) => setIsPreview(event.target.checked)}
            className="mt-1"
          />
          {t("creatorEditor.assets.previewHelp")}
        </label>

        {selectedFile ? (
          <div className="flex items-center gap-3 rounded-md bg-[var(--color-surface-soft)] px-4 py-3 text-xs font-semibold text-[var(--color-primary)]">
            {previewUrl ? (
              // Local blob URL; next/image does not apply to an in-memory object.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={t("creatorEditor.assets.previewAlt").replace("{fileName}", () => selectedFile.name)}
                className={`shrink-0 rounded-md border border-[var(--color-line)] bg-white object-cover ${kind === "module_cover" ? "aspect-[2/3] w-24" : "h-16 w-24"}`}
              />
            ) : null}
            <span>
              {t("creatorEditor.assets.selected").replace(/\{fileName\}|\{size\}/g, (token) => token === "{fileName}" ? selectedFile.name : formatCourseAssetSize(selectedFile.size))}
            </span>
          </div>
        ) : null}

        {/* After the preview option and the thumbnail: whoever uploads sees first everything
            that changes the upload. Fixed label: the progress is only the note right below
            (it used to say "Uploading 45%" under an "Uploading..." button).
            The waiting face repeats the label with the ring, in the already reserved place. */}
        <Button
          type="submit"
          loading={isUploading}
          busyLabel={t("creatorEditor.assets.upload")}
          disabled={!isEditable || !selectedFile || (requiresModuleTarget && !moduleId)}
          className="justify-self-start"
        >
          {t("creatorEditor.assets.upload")}
        </Button>

        {uploadProgress ? <UploadProgressNote progress={uploadProgress} /> : null}

        {error ? (
          <InlineAlert tone="error">{errorMessage}</InlineAlert>
        ) : null}

        {success ? (
          <p role="status" className="info-notice">
            {success === "uploaded" ? t("creatorEditor.assets.uploaded") : t("creatorEditor.lesson.success.deleted")}
          </p>
        ) : null}

      </form>

      <div className="mt-6 grid gap-4">
        {assets.length === 0 ? (
          <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.assets.empty")}
          </p>
        ) : (
          <>
            <AssetGroup
              title={t("creatorEditor.assets.courseGroup")}
              assets={courseLevelAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={setAskingAsset}
            />
            <AssetGroup
              title={t("creatorEditor.assets.moduleGroup")}
              assets={moduleAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={setAskingAsset}
            />
            <AssetGroup
              title={t("creatorEditor.assets.lessonGroup")}
              assets={lessonAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={setAskingAsset}
            />
          </>
        )}
      </div>

      {/* The sentence is the same as the old window.confirm; what changes is the box. */}
      {askingAsset ? (
        <ConfirmDialog
          title={t("creatorEditor.lesson.deleteTitle")}
          confirmLabel={t("creatorEditor.lesson.deleteFile")}
          pendingLabel={t("creatorEditor.lesson.deleting")}
          cancelLabel={t("creatorEditor.lesson.keepFile")}
          danger
          onConfirm={() => handleDeleteAsset(askingAsset)}
          onClose={() => setAskingAsset(null)}
        >
          {t("creatorEditor.lesson.deleteConfirm").replace("{fileName}", () => askingAsset.fileName)}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function AssetGroup({
  title,
  assets,
  allModules,
  allLessons,
  isEditable,
  deletingAssetId,
  onDelete,
}: {
  title: string;
  assets: CourseAsset[];
  allModules: Array<{ id: string; title: string }>;
  allLessons: Array<{ id: string; title: string; moduleTitle: string }>;
  isEditable: boolean;
  deletingAssetId: string | null;
  onDelete: (asset: CourseAsset) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
        {title}
      </p>
      {assets.length === 0 ? (
        <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-3 text-xs leading-5 text-[var(--color-ink-soft)]">
          {t("creatorEditor.assets.groupEmpty")}
        </p>
      ) : (
        assets.map((asset) => {
          const lesson = asset.lessonId
            ? allLessons.find((item) => item.id === asset.lessonId)
            : null;
          const targetModule = asset.moduleId
            ? allModules.find((item) => item.id === asset.moduleId)
            : null;

          return (
            <article
              key={asset.id}
              className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                {asset.downloadUrl && asset.contentType.startsWith("image/") ? (
                  // Covers live in the public bucket: the URL is already on the row.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.downloadUrl}
                    alt={`${getCourseAssetKindLabel(asset.kind, t)}: ${asset.fileName}`}
                    className={`shrink-0 rounded-md border border-[var(--color-line)] bg-white object-cover ${asset.kind === "module_cover" ? "aspect-[2/3] w-24" : "h-16 w-24"}`}
                  />
                ) : null}
                {/* basis-32: at 375px, next to the thumbnail and the badge, the file name
                    was left with 72px and broke into up to 7 lines. With the
                    basis it gets 160px and the badge drops. */}
                <div className="min-w-0 flex-1 basis-32">
                  <p className="wrap-anywhere text-sm font-semibold text-[var(--color-ink)]">
                    {asset.fileName}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}
                  </p>
                  {asset.lessonId ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {t("creatorEditor.assets.lesson")}{" "}
                      {lesson
                        ? `${lesson.moduleTitle} - ${lesson.title}`
                        : asset.lessonId}
                    </p>
                  ) : null}
                  {asset.moduleId ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {t("creatorEditor.assets.module")} {targetModule ? targetModule.title : asset.moduleId}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-chip bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {asset.isPreview ? t("creatorEditor.lesson.state.preview") : t("creatorEditor.lesson.state.private")}
                </span>
              </div>
              {isEditable ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onDelete(asset)}
                    disabled={deletingAssetId === asset.id}
                    className="button-danger px-3.5 py-2 text-xs"
                  >
                    <BusyLabel
                      busy={deletingAssetId === asset.id}
                      idle={t("creatorEditor.lesson.delete")}
                      busyText={t("creatorEditor.lesson.deleting")}
                    />
                  </button>
                </div>
              ) : null}
            </article>
          );
        })
      )}
    </div>
  );
}
