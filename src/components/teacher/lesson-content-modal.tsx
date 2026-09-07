"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  FileText,
  Film,
  Image as ImageIcon,
  Settings,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";

import { LessonVideoSourcePicker } from "@/components/teacher/lesson-video-source-picker";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import { TrustedEmbedPlayer } from "@/components/learn/trusted-embed-player";
import { ProtectedAssetPreview } from "@/components/shared/protected-asset-preview";
import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  bunnyVideoMaxBytes,
  courseAssetAcceptTypes,
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
  getPrimaryLessonVideoAsset,
  isAllowedBunnyVideoFile,
  isAllowedCourseAssetFile,
  isVideoAssetKind,
  supabaseUploadLimitBytes,
} from "@/domain/course-asset";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { getSafeMediaUrl } from "@/domain/external-url";
import {
  resolveLessonVideoSource,
  type LessonType,
  type TeacherCourse,
  type TeacherCourseModule,
  type TeacherLesson,
} from "@/domain/teacher-course";
import {
  CourseAssetUploadCancelled,
  deleteCourseAsset,
  subscribeToCourseAssets,
  uploadCourseAsset,
  uploadLessonVideoToBunny,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";
import { isBunnyConfigured } from "@/lib/bunny/config";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";

type LessonContentModalProps = {
  course: TeacherCourse;
  module: TeacherCourseModule;
  moduleIndex: number;
  lesson: TeacherLesson;
  lessonIndex: number;
  isEditable: boolean;
  isFreePreview: boolean;
  onClose: () => void;
  onSetFreePreview: () => void;
  onUpdateLesson: (patch: Partial<TeacherLesson>) => void;
};

type LessonModalTab = "video" | "description" | "materials" | "settings";
type LessonError =
  | { kind: "load" | "delete" }
  | { kind: "notVideo"; fileName: string }
  | { kind: "videoTooLarge"; size: number; limitBytes: number }
  | { kind: "videoLimit"; limitBytes: number }
  | { kind: "invalidFile"; assetKind: CourseAssetKind; limitBytes: number }
  | { kind: "upload"; cause: unknown; limitBytes: number };

function getLessonErrorMessage(error: LessonError | null, t: (key: string) => string): string {
  if (!error) return "";
  if (error.kind === "upload") {
    return getCourseAssetUploadErrorMessage(error.cause, error.limitBytes, t);
  }
  let message = t(`creatorEditor.lesson.errors.${error.kind}`);
  if (error.kind === "notVideo") return message.replace("{fileName}", () => error.fileName);
  if ("limitBytes" in error) {
    message = message.replace("{limit}", () => formatCourseAssetSize(error.limitBytes));
  }
  if (error.kind === "videoTooLarge") return message.replace("{size}", () => formatCourseAssetSize(error.size));
  if (error.kind === "invalidFile") {
    return message.replace("{kind}", () => getCourseAssetKindLabel(error.assetKind, t).toLowerCase());
  }
  return message;
}

// Author preview never advances or records a student's lesson progress.
function handlePreviewEnded() {}

const lessonModalTabs: Array<{
  value: LessonModalTab;
  icon: LucideIcon;
}> = [
  { value: "video", icon: Film },
  { value: "description", icon: FileText },
  { value: "materials", icon: UploadCloud },
  { value: "settings", icon: Settings },
];

const editableLessonTypes: LessonType[] = [
  "video",
  "text",
  // Quiz/assignment authoring is intentionally hidden until a real assessment
  // engine exists (no question/submission/grading model yet). Exposing them lets
  // instructors sell a course whose paid lessons render only a placeholder.
  // See docs/plans/2026-06-23-launch-readiness.md (B8). The LessonType union and
  // student-side rendering are kept for forward-compat.
  "live_recording",
  "download",
  "external_embed",
];

function getAssetStatus(assets: CourseAsset[], lesson: TeacherLesson) {
  const hasVideo = assets.some((asset) => isVideoAssetKind(asset.kind));

  if (hasVideo) {
    return "uploaded";
  }

  if (getTrustedLessonEmbed(lesson.externalUrl)) {
    return "embedded";
  }

  return "empty";
}

function formatProgress(progress: UploadCourseAssetProgress | null, t: (key: string) => string) {
  if (!progress) {
    return "";
  }

  // Sem porcentagem do transporte (Supabase Storage), não inventa "0%".
  if (progress.percent === null) {
    return t("creatorEditor.lesson.progress.sending")
      .replace("{total}", () => formatCourseAssetSize(progress.totalBytes));
  }

  return t("creatorEditor.lesson.progress.determinate")
    .replace("{percent}", () => String(progress.percent))
    .replace("{transferred}", () => formatCourseAssetSize(progress.bytesTransferred))
    .replace("{total}", () => formatCourseAssetSize(progress.totalBytes));
}

export function LessonContentModal({
  course,
  module,
  moduleIndex,
  lesson,
  lessonIndex,
  isEditable,
  isFreePreview,
  onClose,
  onSetFreePreview,
  onUpdateLesson,
}: LessonContentModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LessonModalTab>("video");
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const [uploadKind, setUploadKind] = useState<CourseAssetKind>("lesson_video");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isPreviewAsset, setIsPreviewAsset] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Guarda o cancelador entregue pelo uploader enquanto o envio corre.
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState<LessonError | null>(null);
  const [success, setSuccess] = useState<"uploaded" | "deleted" | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const lessonAssets = assets.filter((asset) => asset.lessonId === lesson.id);
  const videoAssets = lessonAssets.filter((asset) => isVideoAssetKind(asset.kind));
  const materialAssets = lessonAssets.filter((asset) => asset.kind === "lesson_material");
  const thumbnailAssets = lessonAssets.filter((asset) => asset.kind === "lesson_thumbnail");
  const trustedEmbed = getTrustedLessonEmbed(lesson.externalUrl);
  const primaryVideo = getPrimaryLessonVideoAsset(lessonAssets);
  const resolvedSource = resolveLessonVideoSource({
    declared: lesson.videoSource,
    hasVideoAsset: Boolean(primaryVideo),
    hasTrustedEmbed: Boolean(trustedEmbed),
  });
  // O painel de envio abre pela INTENÇÃO do professor (escolheu um arquivo),
  // não pelo campo persistido. São duas perguntas diferentes que o `videoSource`
  // vinha respondendo sozinho: "que editor eu mostro agora" e "que player o
  // aluno recebe". Amarrar a primeira ao campo salvo deixava o único caminho de
  // envio inalcançável numa aula nova — a fonte só vira "upload" no sucesso do
  // envio, e o envio só aparecia se a fonte já fosse "upload".
  const isUploadPanelOpen = resolvedSource === "upload" || selectedFile !== null;
  const videoStatus = t(`creatorEditor.lesson.state.${getAssetStatus(lessonAssets, lesson)}`);
  const errorMessage = getLessonErrorMessage(error, t);
  const successMessage = success ? t(`creatorEditor.lesson.success.${success}`) : "";

  const dialogRef = useRef<HTMLElement>(null);

  useModalFocus(dialogRef, true);

  // Closing mid-upload would drop the progress UI while bytes are still
  // flying — every close affordance funnels through requestClose so an
  // in-flight upload can't be dismissed by accident.
  function requestClose() {
    if (isUploading) {
      return;
    }

    onClose();
  }

  useEffect(() => {
    return subscribeToCourseAssets(
      course.id,
      setAssets,
      () => setError({ kind: "load" }),
    );
  }, [course.id]);

  // The parent mounts this modal conditionally, so it is always "open" while
  // mounted — Escape mirrors the close affordances (X button / Done / overlay).
  // Re-binding when isUploading flips is what keeps Escape from dismissing an
  // in-flight upload, matching requestClose below.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUploading) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isUploading, onClose]);

  function resetUploadState(nextKind: CourseAssetKind) {
    setUploadKind(nextKind);
    setSelectedFile(null);
    setUploadProgress(null);
    setSuccess(null);
    setError(null);
    setFileInputKey((current) => current + 1);
  }

  function handleTabChange(nextTab: LessonModalTab) {
    setTab(nextTab);

    if (nextTab === "video") {
      resetUploadState("lesson_video");
    }

    if (nextTab === "materials") {
      resetUploadState("lesson_material");
    }

    if (nextTab === "settings") {
      resetUploadState("lesson_thumbnail");
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable || !selectedFile) {
      return;
    }

    setError(null);
    setSuccess(null);

    // Videos route to Bunny Stream (HLS + CDN) when configured; everything else
    // — and videos before Bunny is wired — stays on Supabase Storage.
    const isVideoKind = isVideoAssetKind(uploadKind);
    const useBunny = isVideoKind && isBunnyConfigured;

    if (useBunny) {
      // Separado em duas checagens porque isAllowedBunnyVideoFile reprova tanto
      // tipo quanto tamanho: um PDF de 200 MB recebia uma mensagem sobre o teto
      // de 5 GB, que não tem nada a ver com o motivo da recusa.
      if (!selectedFile.type.startsWith("video/")) {
        setError({ kind: "notVideo", fileName: selectedFile.name });
        return;
      }
      if (selectedFile.size > bunnyVideoMaxBytes) {
        setError({ kind: "videoTooLarge", size: selectedFile.size, limitBytes: bunnyVideoMaxBytes });
        return;
      }
      if (!isAllowedBunnyVideoFile(selectedFile)) {
        setError({ kind: "videoLimit", limitBytes: bunnyVideoMaxBytes });
        return;
      }
    } else if (!isAllowedCourseAssetFile(selectedFile, uploadKind)) {
      // Sem Bunny os bytes vão para o Supabase Storage, e o validador já
      // recusa acima do teto do plano (~50 MB), não do bucket — o ramo
      // separado de tamanho que existia aqui virou inalcançável (#138).
      setError({ kind: "invalidFile", assetKind: uploadKind, limitBytes: supabaseUploadLimitBytes });
      return;
    }

    setIsUploading(true);

    // O vídeo da aula marcada como "prévia gratuita" PRECISA subir com
    // is_preview, senão a página pública de vendas não o encontra: a busca
    // anônima em /api/courses/video-token filtra por .eq("is_preview", true).
    //
    // Antes, isso dependia de o criador também marcar um checkbox separado na
    // aba de vídeo. Quem marcava só o toggle da aula — o caminho óbvio, e o
    // único chamado de "prévia" — publicava com tudo verde no estúdio e via
    // "Video unavailable" na própria loja, sem nenhum sinal do que faltava.
    // Duas perguntas para a mesma decisão; agora o toggle da aula manda.
    const uploadAsPreview =
      isPreviewAsset || (isFreePreview && isVideoAssetKind(uploadKind));

    try {
      if (useBunny) {
        await uploadLessonVideoToBunny({
          courseId: course.id,
          ownerId: course.ownerId,
          kind: uploadKind as "lesson_video" | "live_recording",
          file: selectedFile,
          isPreview: uploadAsPreview,
          lessonId: lesson.id,
          onProgress: setUploadProgress,
          // setState com função guarda o CALLBACK, não o resultado dele — daí o
          // wrapper: setCancelUpload(cancel) trataria `cancel` como updater.
          onCancelAvailable: (cancel) => setCancelUpload(() => cancel),
        });
      } else {
        await uploadCourseAsset({
          courseId: course.id,
          ownerId: course.ownerId,
          kind: uploadKind,
          file: selectedFile,
          isPreview: uploadAsPreview,
          lessonId: lesson.id,
          onProgress: setUploadProgress,
        });
      }
      // A fonte da aula passa a ser "upload" AQUI, e não na escolha do arquivo:
      // agora existe de fato um vídeo para tocar. Declarar antes do envio
      // deixava a aula vazia para o aluno pagante enquanto o professor lia
      // "Media is connected." na própria tela.
      if (isVideoKind) {
        onUpdateLesson({ videoSource: "upload" });
      }
      setSuccess("uploaded");
      setSelectedFile(null);
      setUploadProgress(null);
      setIsPreviewAsset(false);
      setFileInputKey((current) => current + 1);
    } catch (caughtError) {
      // Cancelar é desfecho normal, não falha: limpa a tela sem caixa vermelha.
      if (caughtError instanceof CourseAssetUploadCancelled) {
        setUploadProgress(null);
        setSelectedFile(null);
        setFileInputKey((current) => current + 1);
      } else {
        // Show the real blocker (413 size cap, 403 permission, ...) instead of a
        // generic message that made failures look random. E sem deixar o
        // progresso antigo na tela ao lado da caixa vermelha.
        setUploadProgress(null);
        setError({ kind: "upload", cause: caughtError, limitBytes: useBunny ? bunnyVideoMaxBytes : supabaseUploadLimitBytes });
      }
    } finally {
      setCancelUpload(null);
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

    // Apagar o último vídeo deixava a aula declarada como "upload" sem nenhum
    // arquivo para tocar — o mesmo buraco que a auditoria fechou do lado da
    // escolha do arquivo, entrando pela porta dos fundos. O leitor já cai para o
    // embed sozinho (resolveLessonVideoSource), mas limpar aqui evita gravar uma
    // promessa que o banco não pode cumprir.
    const wasLastVideoAsset =
      isVideoAssetKind(asset.kind) && videoAssets.length === 1;

    try {
      await deleteCourseAsset(asset);

      if (wasLastVideoAsset && lesson.videoSource === "upload") {
        onUpdateLesson({ videoSource: null });
      }

      setSuccess("deleted");
    } catch {
      setError({ kind: "delete" });
    } finally {
      setDeletingAssetId(null);
    }
  }

  return (
    <div className="lesson-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="lesson-modal-title"
        className="lesson-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="lesson-modal__header">
          <p className="lesson-modal__crumb">{t("creatorEditor.lesson.number").replace("{lessonIndex}", () => String(lessonIndex + 1))}</p>
          <button type="button" className="lesson-modal__close" onClick={requestClose}>
            <X aria-hidden="true" size={18} />
            <span className="sr-only">{t("creatorEditor.lesson.close")}</span>
          </button>
        </header>

        <nav className="lesson-modal__tabs" aria-label={t("creatorEditor.lesson.setup")}>
          {lessonModalTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.value;
            const badge =
              item.value === "video"
                ? videoStatus
                : item.value === "description"
                  ? lesson.description.trim().length > 0 || lesson.contentText?.trim()
                    ? t("creatorEditor.lesson.state.done")
                    : t("creatorEditor.lesson.state.empty")
                  : item.value === "materials"
                    ? String(materialAssets.length)
                    : isFreePreview
                      ? t("creatorEditor.lesson.state.preview")
                      : t("creatorEditor.lesson.state.private");

            return (
              <button
                key={item.value}
                type="button"
                aria-current={active ? "page" : undefined}
                className={active ? "is-active" : ""}
                disabled={isUploading}
                onClick={() => handleTabChange(item.value)}
              >
                <Icon aria-hidden="true" size={14} />
                {t(`creatorEditor.lesson.tabs.${item.value}`)}
                <span>{badge}</span>
              </button>
            );
          })}
        </nav>

        <div className="lesson-modal__body">
          <div className="lesson-modal__context">
            <h3 id="lesson-modal-title">{lesson.title || t("creatorEditor.lesson.untitled")}</h3>
            <p className="lesson-modal__crumb">
              {t("creatorEditor.lesson.context")
                .replace("{moduleIndex}", () => String(moduleIndex + 1))
                .replace("{lessonIndex}", () => String(lessonIndex + 1))
                .replace("{moduleTitle}", () => module.title)}
            </p>
          </div>
          {tab === "video" ? (
            <div className="grid gap-5">
              {resolvedSource ? (
                <section aria-label={t("creatorEditor.lesson.previewLabel")} className="grid min-w-0 gap-2">
                  <h4 className="text-sm font-semibold">{t("creatorEditor.lesson.previewTitle")}</h4>
                  {resolvedSource === "upload" && primaryVideo ? (
                    primaryVideo.bunnyVideoId ? (
                      <>
                        <BunnyVideoPlayer key={primaryVideo.id} assetId={primaryVideo.id} title={lesson.title} />
                        <p className="text-sm text-[var(--color-ink-soft)]">
                          {t("creatorEditor.lesson.savedProcessing")}
                        </p>
                      </>
                    ) : (
                      <ProtectedAssetPreview key={primaryVideo.id} asset={primaryVideo} />
                    )
                  ) : resolvedSource === "youtube" && trustedEmbed ? (
                    <TrustedEmbedPlayer
                      key={trustedEmbed.embedUrl}
                      embedUrl={trustedEmbed.embedUrl}
                      provider={trustedEmbed.provider}
                      title={lesson.title}
                      onEnded={handlePreviewEnded}
                    />
                  ) : null}
                </section>
              ) : null}

              <LessonVideoSourcePicker
                value={isUploadPanelOpen ? "upload" : resolvedSource}
                disabled={!isEditable || isUploading}
                accept={courseAssetAcceptTypes[uploadKind]}
                externalUrl={lesson.externalUrl ?? ""}
                embedStatus={
                  trustedEmbed
                    ? t("creatorEditor.lesson.embedDetected").replace("{provider}", () => trustedEmbed.provider === "youtube" ? "YouTube" : "Vimeo")
                    : lesson.externalUrl
                      ? t("creatorEditor.lesson.embedInvalid")
                      : t("creatorEditor.lesson.embedEmpty")
                }
                onChange={(videoSource) => onUpdateLesson({ videoSource })}
                onSelectFile={(file) => {
                  setSelectedFile(file);
                  setUploadProgress(null);
                  setSuccess(null);
                  setError(null);
                }}
                onExternalUrlChange={(nextUrl) =>
                  onUpdateLesson({ externalUrl: nextUrl || null })
                }
              />

              {isUploadPanelOpen ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      className={`lesson-modal-choice ${uploadKind === "lesson_video" ? "is-active" : ""}`}
                      onClick={() => resetUploadState("lesson_video")}
                      disabled={!isEditable || isUploading}
                    >
                      <Film aria-hidden="true" size={18} />
                      <strong>{t("creatorEditor.lesson.uploadVideo")}</strong>
                      <small>{t("creatorEditor.lesson.uploadVideoHelp")}</small>
                    </button>
                    <button
                      type="button"
                      className={`lesson-modal-choice ${uploadKind === "live_recording" ? "is-active" : ""}`}
                      onClick={() => resetUploadState("live_recording")}
                      disabled={!isEditable || isUploading}
                    >
                      <UploadCloud aria-hidden="true" size={18} />
                      <strong>{t("creatorEditor.lesson.uploadRecording")}</strong>
                      <small>{t("creatorEditor.lesson.uploadRecordingHelp")}</small>
                    </button>
                  </div>

                  <LessonUploadForm
                    error={errorMessage}
                    isEditable={isEditable}
                    isPreviewAsset={isPreviewAsset}
                    isUploading={isUploading}
                    onChangePreview={setIsPreviewAsset}
                    onFileChange={(file) => {
                      setSelectedFile(file);
                      setUploadProgress(null);
                      setSuccess(null);
                      setError(null);
                    }}
                    onSubmit={handleUpload}
                    progressLabel={formatProgress(uploadProgress, t)}
                    onCancel={cancelUpload}
                    selectedFile={selectedFile}
                    fileInputKey={fileInputKey}
                    success={successMessage}
                    uploadKind={uploadKind}
                  />

                  <LessonAssetList
                    assets={videoAssets}
                    emptyLabel={t("creatorEditor.lesson.noVideo")}
                    isEditable={isEditable}
                    deletingAssetId={deletingAssetId}
                    onDelete={handleDeleteAsset}
                  />
                </>
              ) : null}

              <p className="lesson-modal__guidance">
                {t("creatorEditor.lesson.videoHelp")}
              </p>
            </div>
          ) : null}

          {tab === "description" ? (
            <div className="grid gap-4">
              <label className="lesson-modal-field">
                <span>{t("creatorEditor.lesson.title")}</span>
                <input
                  value={lesson.title}
                  onChange={(event) => onUpdateLesson({ title: event.target.value })}
                  disabled={!isEditable}
                />
              </label>
              <label className="lesson-modal-field">
                <span>
                  {t("creatorEditor.lesson.description")}
                  <small>{t("creatorEditor.lesson.descriptionHelp")}</small>
                </span>
                <textarea
                  value={lesson.description}
                  onChange={(event) => onUpdateLesson({ description: event.target.value })}
                  disabled={!isEditable}
                  rows={5}
                  placeholder={t("creatorEditor.lesson.descriptionPlaceholder")}
                />
              </label>
              <label className="lesson-modal-field">
                <span>
                  {t("creatorEditor.lesson.text")}
                  <small>{t("creatorEditor.lesson.textHelp")}</small>
                </span>
                <textarea
                  value={lesson.contentText ?? ""}
                  onChange={(event) => onUpdateLesson({ contentText: event.target.value || null })}
                  disabled={!isEditable}
                  rows={7}
                  placeholder={t("creatorEditor.lesson.textPlaceholder")}
                />
              </label>
            </div>
          ) : null}

          {tab === "materials" ? (
            <div className="grid gap-5">
              <div className="lesson-modal-note">
                <FileText aria-hidden="true" size={17} />
                <p>
                  {t("creatorEditor.lesson.materialsHelp")}
                </p>
              </div>
              <LessonUploadForm
                error={errorMessage}
                isEditable={isEditable}
                isPreviewAsset={isPreviewAsset}
                isUploading={isUploading}
                onChangePreview={setIsPreviewAsset}
                onFileChange={(file) => {
                  resetUploadState("lesson_material");
                  setSelectedFile(file);
                }}
                onSubmit={(event) => {
                  setUploadKind("lesson_material");
                  void handleUpload(event);
                }}
                progressLabel={formatProgress(uploadProgress, t)}
                onCancel={cancelUpload}
                selectedFile={selectedFile}
                fileInputKey={fileInputKey}
                success={successMessage}
                uploadKind="lesson_material"
              />
              <LessonAssetList
                assets={materialAssets}
                emptyLabel={t("creatorEditor.lesson.noMaterials")}
                isEditable={isEditable}
                deletingAssetId={deletingAssetId}
                onDelete={handleDeleteAsset}
              />
            </div>
          ) : null}

          {tab === "settings" ? (
            <div className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="lesson-modal-field">
                  <span>{t("creatorEditor.lesson.type")}</span>
                  <select
                    value={lesson.type}
                    onChange={(event) => onUpdateLesson({ type: event.target.value as LessonType })}
                    disabled={!isEditable}
                  >
                    {editableLessonTypes.map((type) => (
                      <option key={type} value={type}>
                        {t(`publicCourses.lessonTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lesson-modal-field">
                  <span>{t("creatorEditor.lesson.duration")}</span>
                  <input
                    value={lesson.durationMinutes ?? ""}
                    inputMode="numeric"
                    onChange={(event) => {
                      const parsedValue = Number(event.target.value);
                      onUpdateLesson({
                        durationMinutes:
                          Number.isFinite(parsedValue) && parsedValue > 0
                            ? Math.round(parsedValue)
                            : null,
                      });
                    }}
                    disabled={!isEditable}
                    placeholder="12"
                  />
                </label>
              </div>
              <div className="lesson-modal-setting">
                <div>
                  <strong>{t("creatorEditor.lesson.freePreview")}</strong>
                  <p>{t("creatorEditor.lesson.freePreviewHelp")}</p>
                </div>
                <button
                  type="button"
                  className={isFreePreview ? "is-on" : ""}
                  onClick={onSetFreePreview}
                  disabled={!isEditable}
                  aria-pressed={isFreePreview}
                  aria-label={t("creatorEditor.lesson.freePreviewLabel")}
                />
              </div>
              <label className="lesson-modal-field">
                <span>
                  {t("creatorEditor.lesson.drip")}
                  <small>{t("creatorEditor.lesson.dripHelp")}</small>
                </span>
                <input
                  value={lesson.dripDelayDays ?? ""}
                  inputMode="numeric"
                  onChange={(event) => {
                    const parsedValue = Number(event.target.value);
                    onUpdateLesson({
                      dripDelayDays:
                        event.target.value.trim() && Number.isFinite(parsedValue) && parsedValue >= 0
                          ? Math.round(parsedValue)
                          : null,
                    });
                  }}
                  disabled={!isEditable}
                  placeholder="7"
                />
              </label>
              <div className="lesson-modal-note">
                <ImageIcon aria-hidden="true" size={17} />
                <p>
                  {t("creatorEditor.lesson.thumbnailHelp")}
                </p>
              </div>
              <LessonUploadForm
                error={errorMessage}
                isEditable={isEditable}
                isPreviewAsset={isPreviewAsset}
                isUploading={isUploading}
                onChangePreview={setIsPreviewAsset}
                onFileChange={(file) => {
                  resetUploadState("lesson_thumbnail");
                  setSelectedFile(file);
                }}
                onSubmit={(event) => {
                  setUploadKind("lesson_thumbnail");
                  void handleUpload(event);
                }}
                progressLabel={formatProgress(uploadProgress, t)}
                onCancel={cancelUpload}
                selectedFile={selectedFile}
                fileInputKey={fileInputKey}
                success={successMessage}
                uploadKind="lesson_thumbnail"
              />
              <LessonAssetList
                assets={thumbnailAssets}
                emptyLabel={t("creatorEditor.lesson.noThumbnail")}
                isEditable={isEditable}
                deletingAssetId={deletingAssetId}
                onDelete={handleDeleteAsset}
              />
            </div>
          ) : null}
          <p className="lesson-modal__guidance">
            {t("creatorEditor.lesson.contextHelp")}
          </p>
        </div>

        <footer className="lesson-modal__footer">
          <p>
            <CheckCircle2 aria-hidden="true" size={14} />
            {t("creatorEditor.lesson.saveHelp")}
          </p>
          <button
            type="button"
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            onClick={requestClose}
            disabled={isUploading}
          >
            {isUploading ? t("creatorEditor.lesson.file.uploading") : t("creatorEditor.lesson.state.done")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function LessonUploadForm({
  error,
  fileInputKey,
  isEditable,
  isPreviewAsset,
  isUploading,
  onCancel,
  onChangePreview,
  onFileChange,
  onSubmit,
  progressLabel,
  selectedFile,
  success,
  uploadKind,
}: {
  error: string;
  fileInputKey: number;
  isEditable: boolean;
  isPreviewAsset: boolean;
  isUploading: boolean;
  /** Disponível só enquanto há bytes em voo; null fora disso. */
  onCancel?: (() => void) | null;
  onChangePreview: (nextValue: boolean) => void;
  onFileChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  progressLabel: string;
  selectedFile: File | null;
  success: string;
  uploadKind: CourseAssetKind;
}) {
  const { t } = useTranslation();
  return (
    <form className="lesson-modal-upload" onSubmit={onSubmit}>
      <label>
        <span>{getCourseAssetKindLabel(uploadKind, t)}</span>
        <input
          key={`${fileInputKey}-${uploadKind}`}
          type="file"
          accept={courseAssetAcceptTypes[uploadKind]}
          disabled={!isEditable || isUploading}
          aria-label={getCourseAssetKindLabel(uploadKind, t)}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          className="lesson-modal-upload__input"
        />
        <span
          className="lesson-modal-upload__trigger"
          data-disabled={!isEditable || isUploading ? "true" : undefined}
        >
          <UploadCloud size={16} aria-hidden />
          {t(`creatorEditor.lesson.file.${selectedFile ? "selectAnother" : "select"}`)}
        </span>
      </label>
      <label className="lesson-modal-upload__preview">
        <input
          type="checkbox"
          checked={isPreviewAsset}
          disabled={!isEditable || isUploading}
          onChange={(event) => onChangePreview(event.target.checked)}
        />
        {t("creatorEditor.lesson.file.allowPreview")}
      </label>
      {selectedFile ? (
        <p className="lesson-modal-upload__file">
          {selectedFile.name} - {formatCourseAssetSize(selectedFile.size)}
        </p>
      ) : null}
      {progressLabel ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="lesson-modal-upload__file">{progressLabel}</p>
          {/* Sem isto não havia saída: durante o envio o modal sela (Escape,
              X, Done e o overlay ficam inertes) e a instância do tus vivia
              presa no executor da Promise, então abort() era inalcançável.
              Arquivo errado de 4 GB ou conexão ruim só se resolviam fechando
              a aba — e aí nada retomava. */}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-md border border-[var(--color-line)] px-3 text-xs font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              {t("creatorEditor.lesson.file.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="lesson-modal-upload__error">{error}</p> : null}
      {success ? <p className="lesson-modal-upload__success">{success}</p> : null}
      <button
        type="submit"
        disabled={!isEditable || isUploading || !selectedFile}
        className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {t(`creatorEditor.lesson.file.${isUploading ? "uploading" : "upload"}`)}
      </button>
    </form>
  );
}

function LessonAssetList({
  assets,
  emptyLabel,
  isEditable,
  deletingAssetId,
  onDelete,
}: {
  assets: CourseAsset[];
  emptyLabel: string;
  isEditable: boolean;
  deletingAssetId: string | null;
  onDelete: (asset: CourseAsset) => void;
}) {
  const { t } = useTranslation();
  if (assets.length === 0) {
    return <p className="lesson-modal-empty">{emptyLabel}</p>;
  }

  return (
    <div className="lesson-modal-assets">
      {assets.map((asset) => {
        const thumbnailUrl = asset.kind === "lesson_thumbnail"
          ? getSafeMediaUrl(asset.downloadUrl)
          : null;
        return (
        <article key={asset.id}>
          <div>
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnailUrl} alt={t("creatorEditor.lesson.thumbnailAlt").replace("{fileName}", () => asset.fileName)} className="mb-2 max-h-32 max-w-full rounded-lg object-contain" />
            ) : null}
            <strong>{asset.fileName}</strong>
            <span>
              {getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <small>{asset.isPreview ? t("creatorEditor.lesson.state.preview") : t("creatorEditor.lesson.enrolledOnly")}</small>
            {isEditable ? (
              <button
                type="button"
                onClick={() => onDelete(asset)}
                disabled={deletingAssetId === asset.id}
                className="button-danger px-3.5 py-2 text-xs disabled:opacity-60"
              >
                {t(`creatorEditor.lesson.${deletingAssetId === asset.id ? "deleting" : "delete"}`)}
              </button>
            ) : null}
          </div>
        </article>
        );
      })}
    </div>
  );
}
