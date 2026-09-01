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
import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  bunnyVideoMaxBytes,
  courseAssetAcceptTypes,
  courseAssetKindLabels,
  courseAssetUploadLimitMessage,
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
  isAllowedBunnyVideoFile,
  isAllowedCourseAssetFile,
  isVideoAssetKind,
  supabaseUploadLimitBytes,
} from "@/domain/course-asset";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
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

const lessonModalTabs: Array<{
  value: LessonModalTab;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "video", label: "Video", icon: Film },
  { value: "description", label: "Description", icon: FileText },
  { value: "materials", label: "Materials", icon: UploadCloud },
  { value: "settings", label: "Settings", icon: Settings },
];

const editableLessonTypes: Array<{ value: LessonType; label: string }> = [
  { value: "video", label: "Video lesson" },
  { value: "text", label: "Text lesson" },
  // Quiz/assignment authoring is intentionally hidden until a real assessment
  // engine exists (no question/submission/grading model yet). Exposing them lets
  // instructors sell a course whose paid lessons render only a placeholder.
  // See docs/plans/2026-06-23-launch-readiness.md (B8). The LessonType union and
  // student-side rendering are kept for forward-compat.
  { value: "live_recording", label: "Live recording" },
  { value: "download", label: "Download" },
  { value: "external_embed", label: "External embed" },
];

function getAssetStatusLabel(assets: CourseAsset[], lesson: TeacherLesson) {
  const hasVideo = assets.some((asset) => isVideoAssetKind(asset.kind));

  if (hasVideo) {
    return "Uploaded";
  }

  if (getTrustedLessonEmbed(lesson.externalUrl)) {
    return "Embedded";
  }

  return "Empty";
}

function formatProgress(progress: UploadCourseAssetProgress | null) {
  if (!progress) {
    return "";
  }

  return `${progress.percent}% - ${formatCourseAssetSize(progress.bytesTransferred)} of ${formatCourseAssetSize(progress.totalBytes)}`;
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const lessonAssets = assets.filter((asset) => asset.lessonId === lesson.id);
  const videoAssets = lessonAssets.filter((asset) => isVideoAssetKind(asset.kind));
  const materialAssets = lessonAssets.filter((asset) => asset.kind === "lesson_material");
  const thumbnailAssets = lessonAssets.filter((asset) => asset.kind === "lesson_thumbnail");
  const trustedEmbed = getTrustedLessonEmbed(lesson.externalUrl);
  const resolvedSource = resolveLessonVideoSource({
    declared: lesson.videoSource,
    hasVideoAsset: videoAssets.length > 0,
    hasTrustedEmbed: Boolean(trustedEmbed),
  });
  // O painel de envio abre pela INTENÇÃO do professor (escolheu um arquivo),
  // não pelo campo persistido. São duas perguntas diferentes que o `videoSource`
  // vinha respondendo sozinho: "que editor eu mostro agora" e "que player o
  // aluno recebe". Amarrar a primeira ao campo salvo deixava o único caminho de
  // envio inalcançável numa aula nova — a fonte só vira "upload" no sucesso do
  // envio, e o envio só aparecia se a fonte já fosse "upload".
  const isUploadPanelOpen = resolvedSource === "upload" || selectedFile !== null;
  const videoStatus = getAssetStatusLabel(lessonAssets, lesson);

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
      () => setError("We could not load lesson assets."),
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
    setSuccess("");
    setError("");
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

    setError("");
    setSuccess("");

    // Videos route to Bunny Stream (HLS + CDN) when configured; everything else
    // — and videos before Bunny is wired — stays on Supabase Storage.
    const isVideoKind = isVideoAssetKind(uploadKind);
    const useBunny = isVideoKind && isBunnyConfigured;

    if (useBunny) {
      // Separado em duas checagens porque isAllowedBunnyVideoFile reprova tanto
      // tipo quanto tamanho: um PDF de 200 MB recebia uma mensagem sobre o teto
      // de 5 GB, que não tem nada a ver com o motivo da recusa.
      if (!selectedFile.type.startsWith("video/")) {
        setError(
          `"${selectedFile.name}" is not a video file. Use MP4, MOV or WebM.`,
        );
        return;
      }
      if (selectedFile.size > bunnyVideoMaxBytes) {
        setError(
          `This video is ${formatCourseAssetSize(selectedFile.size)} — the limit is ${formatCourseAssetSize(bunnyVideoMaxBytes)}.`,
        );
        return;
      }
      if (!isAllowedBunnyVideoFile(selectedFile)) {
        setError(`Use a video file under ${formatCourseAssetSize(bunnyVideoMaxBytes)}.`);
        return;
      }
    } else if (!isAllowedCourseAssetFile(selectedFile, uploadKind)) {
      setError(
        `Use a valid ${courseAssetKindLabels[uploadKind].toLowerCase()} file under ${formatCourseAssetSize(supabaseUploadLimitBytes)}.`,
      );
      return;
    } else if (selectedFile.size > supabaseUploadLimitBytes) {
      // Without Bunny the bytes go to Supabase Storage, whose plan-level cap
      // (default 50MB) is far below the 500MB bucket ceiling — validate against
      // the limit the API will actually enforce.
      setError(courseAssetUploadLimitMessage());
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
      setSuccess("File uploaded to this lesson.");
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
        // generic message that made failures look random.
        setError(
          getCourseAssetUploadErrorMessage(
            caughtError,
            useBunny ? bunnyVideoMaxBytes : supabaseUploadLimitBytes,
          ),
        );
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
      `Delete "${asset.fileName}"? This permanently removes the file.`,
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
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

      setSuccess("Asset deleted.");
    } catch {
      setError("We could not delete this file. Check course ownership and current permissions.");
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
          <div className="min-w-0">
            <p className="lesson-modal__crumb">
              Module {moduleIndex + 1} - {module.title} / Lesson {lessonIndex + 1}
            </p>
            <h3 id="lesson-modal-title">{lesson.title || "Untitled lesson"}</h3>
            <p>
              Configure the exact lesson students will watch, read, download, and discuss.
            </p>
          </div>
          <button type="button" className="lesson-modal__close" onClick={requestClose}>
            <X aria-hidden="true" size={18} />
            <span className="sr-only">Close lesson studio</span>
          </button>
        </header>

        <nav className="lesson-modal__tabs" aria-label="Lesson setup">
          {lessonModalTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.value;
            const badge =
              item.value === "video"
                ? videoStatus
                : item.value === "description"
                  ? lesson.description.trim().length > 0 || lesson.contentText?.trim()
                    ? "Done"
                    : "Empty"
                  : item.value === "materials"
                    ? String(materialAssets.length)
                    : isFreePreview
                      ? "Preview"
                      : "Private";

            return (
              <button
                key={item.value}
                type="button"
                className={active ? "is-active" : ""}
                onClick={() => handleTabChange(item.value)}
              >
                <Icon aria-hidden="true" size={14} />
                {item.label}
                <span>{badge}</span>
              </button>
            );
          })}
        </nav>

        <div className="lesson-modal__body">
          {tab === "video" ? (
            <div className="grid gap-5">
              <div className="lesson-modal-video">
                <div>
                  <p className="lesson-modal__eyebrow">Primary lesson media</p>
                  <h4>{videoStatus === "Empty" ? "Add a video or embed." : "Media is connected."}</h4>
                  <p>
                    Upload the video to SkillsetMind or paste a YouTube/Vimeo URL.
                    Learners can play either one in the classroom.
                  </p>
                </div>
                <span>{videoStatus}</span>
              </div>

              <LessonVideoSourcePicker
                value={isUploadPanelOpen ? "upload" : resolvedSource}
                disabled={!isEditable || isUploading}
                accept={courseAssetAcceptTypes[uploadKind]}
                externalUrl={lesson.externalUrl ?? ""}
                embedStatus={
                  trustedEmbed
                    ? `${trustedEmbed.provider === "youtube" ? "YouTube" : "Vimeo"} embed detected.`
                    : lesson.externalUrl
                      ? "Link saved, but it will not play in the classroom. Use a standard YouTube or Vimeo video URL."
                      : "Paste a link when the video already lives outside SkillsetMind."
                }
                onChange={(videoSource) => onUpdateLesson({ videoSource })}
                onSelectFile={(file) => {
                  setSelectedFile(file);
                  setUploadProgress(null);
                  setSuccess("");
                  setError("");
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
                      <strong>Upload lesson video</strong>
                      <small>MP4, MOV, WebM or any browser-supported video file.</small>
                    </button>
                    <button
                      type="button"
                      className={`lesson-modal-choice ${uploadKind === "live_recording" ? "is-active" : ""}`}
                      onClick={() => resetUploadState("live_recording")}
                      disabled={!isEditable || isUploading}
                    >
                      <UploadCloud aria-hidden="true" size={18} />
                      <strong>Upload live recording</strong>
                      <small>Replay from cohort classes, mentorships or webinars.</small>
                    </button>
                  </div>

                  <LessonUploadForm
                    error={error}
                    isEditable={isEditable}
                    isPreviewAsset={isPreviewAsset}
                    isUploading={isUploading}
                    onChangePreview={setIsPreviewAsset}
                    onFileChange={(file) => {
                      setSelectedFile(file);
                      setUploadProgress(null);
                      setSuccess("");
                      setError("");
                    }}
                    onSubmit={handleUpload}
                    progressLabel={formatProgress(uploadProgress)}
                onCancel={cancelUpload}
                    selectedFile={selectedFile}
                    fileInputKey={fileInputKey}
                    success={success}
                    uploadKind={uploadKind}
                  />

                  <LessonAssetList
                    assets={videoAssets}
                    emptyLabel="No uploaded video file yet."
                    isEditable={isEditable}
                    deletingAssetId={deletingAssetId}
                    onDelete={handleDeleteAsset}
                  />
                </>
              ) : null}

            </div>
          ) : null}

          {tab === "description" ? (
            <div className="grid gap-4">
              <label className="lesson-modal-field">
                <span>Lesson title</span>
                <input
                  value={lesson.title}
                  onChange={(event) => onUpdateLesson({ title: event.target.value })}
                  disabled={!isEditable}
                />
              </label>
              <label className="lesson-modal-field">
                <span>
                  Lesson description
                  <small>Shown below the video in the members area.</small>
                </span>
                <textarea
                  value={lesson.description}
                  onChange={(event) => onUpdateLesson({ description: event.target.value })}
                  disabled={!isEditable}
                  rows={5}
                  placeholder="Explain what the student is about to learn and why it matters."
                />
              </label>
              <label className="lesson-modal-field">
                <span>
                  Text content, prompt, or notes
                  <small>Use this for text lessons, assignments, scripts or key takeaways.</small>
                </span>
                <textarea
                  value={lesson.contentText ?? ""}
                  onChange={(event) => onUpdateLesson({ contentText: event.target.value || null })}
                  disabled={!isEditable}
                  rows={7}
                  placeholder="Add the lesson outline, assignment instructions, checklist, or supporting notes."
                />
              </label>
            </div>
          ) : null}

          {tab === "materials" ? (
            <div className="grid gap-5">
              <div className="lesson-modal-note">
                <FileText aria-hidden="true" size={17} />
                <p>
                  Complementary files are attached to this lesson and become
                  downloadable inside the student classroom.
                </p>
              </div>
              <LessonUploadForm
                error={error}
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
                progressLabel={formatProgress(uploadProgress)}
                onCancel={cancelUpload}
                selectedFile={selectedFile}
                fileInputKey={fileInputKey}
                success={success}
                uploadKind="lesson_material"
              />
              <LessonAssetList
                assets={materialAssets}
                emptyLabel="No complementary materials yet."
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
                  <span>Lesson type</span>
                  <select
                    value={lesson.type}
                    onChange={(event) => onUpdateLesson({ type: event.target.value as LessonType })}
                    disabled={!isEditable}
                  >
                    {editableLessonTypes.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lesson-modal-field">
                  <span>Duration minutes</span>
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
                  <strong>Free preview</strong>
                  <p>Make this lesson visible before purchase. SkillsetMind recommends one strong preview lesson.</p>
                </div>
                <button
                  type="button"
                  className={isFreePreview ? "is-on" : ""}
                  onClick={onSetFreePreview}
                  disabled={!isEditable}
                  aria-pressed={isFreePreview}
                  aria-label="Use this lesson as the free preview"
                />
              </div>
              <label className="lesson-modal-field">
                <span>
                  Drip delay days
                  <small>Leave blank for immediate release, or set D+ days after enrollment.</small>
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
                  Optional thumbnail upload. It is used by the members area when
                  students browse lessons.
                </p>
              </div>
              <LessonUploadForm
                error={error}
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
                progressLabel={formatProgress(uploadProgress)}
                onCancel={cancelUpload}
                selectedFile={selectedFile}
                fileInputKey={fileInputKey}
                success={success}
                uploadKind="lesson_thumbnail"
              />
              <LessonAssetList
                assets={thumbnailAssets}
                emptyLabel="No lesson thumbnail yet."
                isEditable={isEditable}
                deletingAssetId={deletingAssetId}
                onDelete={handleDeleteAsset}
              />
            </div>
          ) : null}
        </div>

        <footer className="lesson-modal__footer">
          <p>
            <CheckCircle2 aria-hidden="true" size={14} />
            Uploads save immediately. Text and settings save with the course draft.
          </p>
          <button
            type="button"
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            onClick={requestClose}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Done"}
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
  return (
    <form className="lesson-modal-upload" onSubmit={onSubmit}>
      <label>
        <span>{courseAssetKindLabels[uploadKind]}</span>
        <input
          key={`${fileInputKey}-${uploadKind}`}
          type="file"
          accept={courseAssetAcceptTypes[uploadKind]}
          disabled={!isEditable || isUploading}
          aria-label={courseAssetKindLabels[uploadKind]}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          className="lesson-modal-upload__input"
        />
        <span
          className="lesson-modal-upload__trigger"
          data-disabled={!isEditable || isUploading ? "true" : undefined}
        >
          <UploadCloud size={16} aria-hidden />
          {selectedFile ? "Choose a different file" : "Choose file"}
        </span>
      </label>
      <label className="lesson-modal-upload__preview">
        <input
          type="checkbox"
          checked={isPreviewAsset}
          disabled={!isEditable || isUploading}
          onChange={(event) => onChangePreview(event.target.checked)}
        />
        Allow this file in the public preview when it is safe.
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
              className="min-h-9 rounded-md border border-[var(--color-line)] px-3 text-xs font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              Cancel upload
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
        {isUploading ? "Uploading..." : "Upload file"}
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
  if (assets.length === 0) {
    return <p className="lesson-modal-empty">{emptyLabel}</p>;
  }

  return (
    <div className="lesson-modal-assets">
      {assets.map((asset) => (
        <article key={asset.id}>
          <div>
            <strong>{asset.fileName}</strong>
            <span>
              {courseAssetKindLabels[asset.kind]} - {formatCourseAssetSize(asset.size)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <small>{asset.isPreview ? "Preview" : "Enrolled only"}</small>
            {isEditable ? (
              <button
                type="button"
                onClick={() => onDelete(asset)}
                disabled={deletingAssetId === asset.id}
                className="button-outline px-3.5 py-2 text-xs text-[var(--color-accent-fg)] disabled:opacity-60"
              >
                {deletingAssetId === asset.id ? "Deleting..." : "Delete"}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
