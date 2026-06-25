"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Layers3,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  courseAssetAcceptTypes,
  courseAssetKindLabels,
  courseAssetMaxBytes,
  formatCourseAssetSize,
  isAllowedCourseAssetFile,
} from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  deleteCourseAsset,
  subscribeToCourseAssets,
  uploadCourseAsset,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";

const assetKinds: CourseAssetKind[] = ["course_cover", "module_cover"];

const moduleTargetKinds: CourseAssetKind[] = ["module_cover"];

const uploadPresets: Array<{
  kind: CourseAssetKind;
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    kind: "module_cover",
    label: "Module cover",
    detail: "Visual cover for one module in the student members area.",
    icon: Layers3,
  },
  {
    kind: "course_cover",
    label: "Course cover",
    detail: "Public artwork for marketplace, course detail, and previews.",
    icon: UploadCloud,
  },
];

type CourseAssetUploaderProps = {
  course: TeacherCourse;
  isEditable: boolean;
};

export function CourseAssetUploader({ course, isEditable }: CourseAssetUploaderProps) {
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const [kind, setKind] = useState<CourseAssetKind>("course_cover");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [moduleId, setModuleId] = useState("");
  const [isPreview, setIsPreview] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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

  useEffect(() => {
    return subscribeToCourseAssets(
      course.id,
      setAssets,
      () => setError("We could not load course assets."),
    );
  }, [course.id]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable || !selectedFile) {
      return;
    }

    setError("");
    setSuccess("");
    setUploadProgress(null);

    if (!isAllowedCourseAssetFile(selectedFile, kind)) {
      setError(
        `Use a valid ${courseAssetKindLabels[kind].toLowerCase()} file under ${formatCourseAssetSize(courseAssetMaxBytes)}.`,
      );
      return;
    }

    if (requiresModuleTarget && !moduleId) {
      setError("Choose the module this cover belongs to.");
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
      setSuccess("Asset uploaded.");
      setSelectedFile(null);
      setModuleId("");
      setIsPreview(false);
      setUploadProgress(null);
      setFileInputKey((current) => current + 1);
    } catch {
      setError("We could not upload this asset. Check the file, course ownership, and current permissions.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteAsset(asset: CourseAsset) {
    if (!isEditable) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${asset.fileName}"? This permanently removes the file.`,
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
    setDeletingAssetId(asset.id);

    try {
      await deleteCourseAsset(asset);
      setSuccess("Asset deleted.");
    } catch {
      setError("We could not delete this asset. Check course ownership and current permissions.");
    } finally {
      setDeletingAssetId(null);
    }
  }

  return (
    <section className="course-upload-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Course media library
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
            Upload covers, videos, and materials for this course.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Upload and manage media for this course and its modules. For
            per-lesson videos, materials, and thumbnails, open the Lesson
            Studio by clicking any lesson in the Curriculum tab.
          </p>
        </div>
        <span className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {assets.length} uploaded
        </span>
      </div>
      {course.coverImageUrl ? (
        <p className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          Course cover is set. Upload another course cover to replace it.
        </p>
      ) : null}

      <form className="mt-5 grid gap-3" onSubmit={handleUpload}>
        <div className="course-upload-presets" role="list" aria-label="Upload type">
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
                  <span className="block text-sm font-bold">{preset.label}</span>
                  <span className="mt-1 block text-xs leading-5">
                    {preset.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
            Uploading
          </p>
          <p className="mt-2 text-sm font-bold text-[var(--color-ink)]">
            {activePreset?.label ?? courseAssetKindLabels[kind]}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
            {activePreset?.detail ?? "Choose the target and file before uploading."}
          </p>
        </div>

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
          className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
        >
          {assetKinds.map((item) => (
            <option key={item} value={item}>
              {courseAssetKindLabels[item]}
            </option>
          ))}
        </select>

        {requiresModuleTarget ? (
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Attach to module
            <select
              value={moduleId}
              onChange={(event) => setModuleId(event.target.value)}
              disabled={!isEditable || isUploading || allModules.length === 0}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
            >
              <option value="">
                {allModules.length === 0 ? "Add modules first" : "Choose module"}
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
          Mark as free preview asset when it is safe to expose before purchase.
        </label>

        {selectedFile ? (
          <p className="rounded-[10px] bg-[var(--color-surface-soft)] px-4 py-3 text-xs font-semibold text-[var(--color-primary)]">
            Selected: {selectedFile.name} ({formatCourseAssetSize(selectedFile.size)})
          </p>
        ) : null}

        {uploadProgress ? (
          <div className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-3">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--color-primary)]">
              <span>
                {uploadProgress.state === "success" ? "Upload complete" : "Uploading"}
              </span>
              <span>{uploadProgress.percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-ink-soft)]">
              {formatCourseAssetSize(uploadProgress.bytesTransferred)} of{" "}
              {formatCourseAssetSize(uploadProgress.totalBytes)}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="info-notice">
            {success}
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
          {isUploading ? "Uploading..." : "Upload asset"}
        </button>
      </form>

      <div className="mt-6 grid gap-4">
        {assets.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No uploaded assets yet. Start with a course cover or first lesson
            material.
          </p>
        ) : (
          <>
            <AssetGroup
              title="Course-level assets"
              assets={courseLevelAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={handleDeleteAsset}
            />
            <AssetGroup
              title="Module assets"
              assets={moduleAssets}
              allModules={allModules}
              allLessons={allLessons}
              isEditable={isEditable}
              deletingAssetId={deletingAssetId}
              onDelete={handleDeleteAsset}
            />
            <AssetGroup
              title="Lesson assets"
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
  return (
    <div className="grid gap-2">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
        {title}
      </p>
      {assets.length === 0 ? (
        <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3 text-xs leading-5 text-[var(--color-ink-soft)]">
          Nothing uploaded here yet.
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
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {asset.fileName}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {courseAssetKindLabels[asset.kind]} - {formatCourseAssetSize(asset.size)}
                  </p>
                  {asset.lessonId ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      Lesson:{" "}
                      {lesson
                        ? `${lesson.moduleTitle} - ${lesson.title}`
                        : asset.lessonId}
                    </p>
                  ) : null}
                  {asset.moduleId ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      Module: {targetModule ? targetModule.title : asset.moduleId}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-[8px] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {asset.isPreview ? "Preview" : "Private"}
                </span>
              </div>
              {isEditable ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onDelete(asset)}
                    disabled={deletingAssetId === asset.id}
                    className="button-outline px-3.5 py-2 text-xs text-[var(--color-accent-fg)] disabled:opacity-60"
                  >
                    {deletingAssetId === asset.id ? "Deleting..." : "Delete"}
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
