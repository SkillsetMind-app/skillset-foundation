"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Layers3,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import { useTranslation } from "@/components/i18n/i18n-provider";
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

import { UploadProgressNote } from "./upload-progress-note";

const assetKinds: CourseAssetKind[] = ["course_cover", "module_cover"];

const moduleTargetKinds: CourseAssetKind[] = ["module_cover"];

const uploadPresets: Array<{
  kind: CourseAssetKind;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    kind: "module_cover",
    // A proporção é a do .member-module-card__cover (16/10, object-cover):
    // sem dizer isso aqui o professor só descobria o enquadramento na área do aluno.
    detail: "creatorEditor.assets.presets.module",
    icon: Layers3,
  },
  {
    kind: "course_cover",
    detail: "creatorEditor.assets.presets.course",
    icon: UploadCloud,
  },
];

type CourseAssetUploaderProps = {
  course: TeacherCourse;
  isEditable: boolean;
};

export function CourseAssetUploader({ course, isEditable }: CourseAssetUploaderProps) {
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
    | { kind: "load" | "module" | "delete" }
    | { kind: "invalidFile"; assetKind: CourseAssetKind }
    | { kind: "upload"; cause: unknown }
    | null
  >(null);
  const [success, setSuccess] = useState<"uploaded" | "deleted" | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
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
      : t(`creatorEditor.assets.errors.${error.kind}`);

  // Prévia do arquivo escolhido antes de enviar. Os dois presets deste painel
  // são imagens; sem isto o professor subia a capa do módulo às cegas.
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

  useEffect(() => {
    return subscribeToCourseAssets(
      course.id,
      setAssets,
      () => setError({ kind: "load" }),
    );
  }, [course.id]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable || !selectedFile) {
      return;
    }

    setError(null);
    setSuccess(null);
    setUploadProgress(null);

    if (!isAllowedCourseAssetFile(selectedFile, kind)) {
      setError({ kind: "invalidFile", assetKind: kind });
      return;
    }

    if (requiresModuleTarget && !moduleId) {
      setError({ kind: "module" });
      return;
    }

    setIsUploading(true);

    try {
      await uploadCourseAsset({
        courseId: course.id,
        ownerId: course.ownerId,
        kind,
        file: selectedFile,
        isPreview,
        lessonId: null,
        moduleId: requiresModuleTarget ? moduleId : null,
        onProgress: setUploadProgress,
      });
      setSuccess("uploaded");
      setSelectedFile(null);
      setModuleId("");
      setIsPreview(false);
      setUploadProgress(null);
      setFileInputKey((current) => current + 1);
    } catch (uploadError) {
      // O motivo real (teto de tamanho, permissão, conexão) já vem pronto do
      // domínio; o texto genérico culpava "permissões" por um 413 de tamanho.
      setUploadProgress(null);
      setError({ kind: "upload", cause: uploadError });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteAsset(asset: CourseAsset) {
    if (!isEditable) {
      return;
    }

    const confirmed = window.confirm(
      t("creatorEditor.lesson.deleteConfirm").replace("{fileName}", () => asset.fileName),
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccess(null);
    setDeletingAssetId(asset.id);

    try {
      await deleteCourseAsset(asset);
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
          <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
            {t("creatorEditor.assets.title")}
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.assets.help")}
          </p>
        </div>
        <span className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {t("creatorEditor.assets.count").replace("{count}", () => String(assets.length))}
        </span>
      </div>
      {course.coverImageUrl ? (
        <p className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          {t("creatorEditor.assets.coverSet")}
        </p>
      ) : null}

      <form className="mt-5 grid gap-3" onSubmit={handleUpload}>
        <div className="course-upload-presets" role="list" aria-label={t("creatorEditor.assets.uploadType")}>
          {uploadPresets.map((preset) => {
            const Icon = preset.icon;
            const active = preset.kind === kind;

            return (
              <button
                key={preset.kind}
                type="button"
                role="listitem"
                onClick={() => {
                  setKind(preset.kind);
                  setModuleId("");
                  setSelectedFile(null);
                  setFileInputKey((current) => current + 1);
                  setUploadProgress(null);
                }}
                disabled={!isEditable || isUploading}
                className={`course-upload-preset ${active ? "course-upload-preset--active" : ""}`}
              >
                <span className="course-upload-preset__icon">
                  <Icon aria-hidden="true" size={18} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{getCourseAssetKindLabel(preset.kind, t)}</span>
                  <span className="mt-1 block text-xs leading-5">
                    {t(preset.detail)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
            {t("creatorEditor.assets.uploadingLabel")}
          </p>
          <p className="mt-2 text-sm font-bold text-[var(--color-ink)]">
            {kindLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
            {activePreset ? t(activePreset.detail) : t("creatorEditor.assets.targetHelp")}{" "}
            {t("creatorEditor.assets.imageLimit").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))}
          </p>
        </div>

        <select
          aria-label={t("creatorEditor.assets.assetType")}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as CourseAssetKind);
            setSelectedFile(null);
            setModuleId("");
            setUploadProgress(null);
            setFileInputKey((current) => current + 1);
          }}
          disabled={!isEditable || isUploading}
          className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
        >
          {assetKinds.map((item) => (
            <option key={item} value={item}>
              {getCourseAssetKindLabel(item, t)}
            </option>
          ))}
        </select>

        {requiresModuleTarget ? (
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("creatorEditor.assets.attachModule")}
            <select
              value={moduleId}
              onChange={(event) => setModuleId(event.target.value)}
              disabled={!isEditable || isUploading || allModules.length === 0}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
          className="rounded-[10px] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-soft)] file:mr-4 file:rounded-[8px] file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--color-primary)] disabled:opacity-60"
        />

        <label className="flex items-start gap-3 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
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
          <div className="flex items-center gap-3 rounded-[10px] bg-[var(--color-surface-soft)] px-4 py-3 text-xs font-semibold text-[var(--color-primary)]">
            {previewUrl ? (
              // Blob URL local; next/image não se aplica a um objeto em memória.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={t("creatorEditor.assets.previewAlt").replace("{fileName}", () => selectedFile.name)}
                className="h-16 w-24 shrink-0 rounded-[8px] border border-[var(--color-line)] bg-white object-cover"
              />
            ) : null}
            <span>
              {t("creatorEditor.assets.selected").replace(/\{fileName\}|\{size\}/g, (token) => token === "{fileName}" ? selectedFile.name : formatCourseAssetSize(selectedFile.size))}
            </span>
          </div>
        ) : null}

        {uploadProgress ? <UploadProgressNote progress={uploadProgress} /> : null}

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {errorMessage}
          </p>
        ) : null}

        {success ? (
          <p className="info-notice">
            {success === "uploaded" ? t("creatorEditor.assets.uploaded") : t("creatorEditor.lesson.success.deleted")}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={
            !isEditable
            || isUploading
            || !selectedFile
            || (requiresModuleTarget && !moduleId)
          }
          className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isUploading ? t("creatorEditor.members.uploading") : t("creatorEditor.assets.upload")}
        </button>
      </form>

      <div className="mt-6 grid gap-4">
        {assets.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
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
              onDelete={handleDeleteAsset}
            />
            <AssetGroup
              title={t("creatorEditor.assets.moduleGroup")}
              assets={moduleAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={handleDeleteAsset}
            />
            <AssetGroup
              title={t("creatorEditor.assets.lessonGroup")}
              assets={lessonAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={handleDeleteAsset}
            />
          </>
        )}
      </div>
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
        <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3 text-xs leading-5 text-[var(--color-ink-soft)]">
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
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                {asset.downloadUrl && asset.contentType.startsWith("image/") ? (
                  // Capas vivem no bucket público: a URL já está na linha.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.downloadUrl}
                    alt={`${getCourseAssetKindLabel(asset.kind, t)}: ${asset.fileName}`}
                    className="h-16 w-24 shrink-0 rounded-[8px] border border-[var(--color-line)] bg-white object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
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
                <span className="rounded-[8px] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {asset.isPreview ? t("creatorEditor.lesson.state.preview") : t("creatorEditor.lesson.state.private")}
                </span>
              </div>
              {isEditable ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onDelete(asset)}
                    disabled={deletingAssetId === asset.id}
                    className="button-danger px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {deletingAssetId === asset.id ? t("creatorEditor.lesson.deleting") : t("creatorEditor.lesson.delete")}
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
