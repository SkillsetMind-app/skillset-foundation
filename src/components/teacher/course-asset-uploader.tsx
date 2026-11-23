"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, ConfirmDialog, InlineAlert } from "@/components/ui";
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
    // A proporção é a do poster de modulo (2/3, object-cover):
    // sem dizer isso aqui o professor só descobria o enquadramento na área do aluno.
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
  // Arquivo que pediu para ser apagado, enquanto a pergunta está aberta.
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

  // course_assets não está na publicação do Realtime: depois de enviar ou
  // apagar, a lista busca de novo em vez de esperar um evento que não vem.
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

    // Capa do módulo: mesmo teto de 10 MB do campo da página do módulo.
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
      // Mesmo recorte 2:3 e compressão do campo da página do módulo; se falhar,
      // sobe o original.
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
      // O motivo real (teto de tamanho, permissão, conexão) já vem pronto do
      // domínio; o texto genérico culpava "permissões" por um 413 de tamanho.
      setUploadProgress(null);
      setError({ kind: "upload", cause: uploadError });
    } finally {
      setIsUploading(false);
    }
  }

  // Roda só pelo confirmar da janela, que antes era o OK do window.confirm.
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
          {/* Título de seção da casa, não display de 30px: a biblioteca é uma
              ferramenta embaixo do construtor, não o assunto da página. */}
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
        {/* Uma linha: tipo, módulo (na capa do módulo) e arquivo. Antes
            eram dois cartões de tipo, uma caixa "UPLOADING" que não enviava
            nada, o mesmo tipo de novo num select e o arquivo nativo esticado,
            um embaixo do outro. Os campos e o envio são os mesmos. */}
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
              className="min-h-11 rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
                className="min-h-11 rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
            className="min-h-11 min-w-0 flex-1 basis-56 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[var(--color-primary)] disabled:opacity-50"
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
              // Blob URL local; next/image não se aplica a um objeto em memória.
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

        {/* Depois da opção de prévia e da miniatura: quem envia vê antes tudo o
            que muda o envio. Rótulo fixo: o andamento é só a nota logo abaixo
            (ela dizia "Uploading 45%" embaixo de um botão "Uploading..."). */}
        <Button
          type="submit"
          loading={isUploading}
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

      {/* A frase é a mesma do antigo window.confirm; o que muda é a caixa. */}
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
                  // Capas vivem no bucket público: a URL já está na linha.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.downloadUrl}
                    alt={`${getCourseAssetKindLabel(asset.kind, t)}: ${asset.fileName}`}
                    className={`shrink-0 rounded-md border border-[var(--color-line)] bg-white object-cover ${asset.kind === "module_cover" ? "aspect-[2/3] w-24" : "h-16 w-24"}`}
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
