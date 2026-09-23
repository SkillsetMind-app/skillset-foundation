"use client";

import Link from "next/link";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
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

import {
  LessonVideoSourcePicker,
  type LessonVideoMode,
  type LessonVideoSourcePickerHandle,
} from "@/components/teacher/lesson-video-source-picker";
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
import type { DripStrategy } from "@/domain/drip-policy";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { getSafeMediaUrl } from "@/domain/external-url";
import {
  resolveLessonVideoSource,
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
import { useLessonUpload, startLessonUpload, cancelLessonUpload } from "@/components/teacher/lesson-upload-provider";
import { lessonUploadIsBusy } from "@/lib/data/lesson-upload";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";

type LessonContentModalProps = {
  // "page": o corpo do estudio na propria pagina do builder (?lesson=L), sem
  // camada escura, sem foco preso e sem Esc para fechar; a trilha
  // Curso > Modulo > Aula fica no lugar do cabecalho.
  variant?: "dialog" | "page";
  crumbs?: {
    courseLabel: string;
    courseHref: string;
    moduleLabel: string;
    moduleHref: string;
    // Sair pela trilha do curso: o builder guarda para onde devolver o foco.
    onCourseNavigate?: () => void;
  };
  // Envio em curso: o builder mantem esta pagina montada ate o envio acabar,
  // mesmo que a URL mude (voltar do navegador, outra aba).
  onUploadingChange?: (uploading: boolean, failed?: boolean) => void;
  // Arquivo enviado ou apagado: o builder busca de novo a lista do curso, e a
  // prontidao do Publish ve o que mudou.
  onAssetsChanged?: () => void;
  // Builder saindo da pagina: grava, sem prompt, o link digitado e sem blur.
  leaveFlushRef?: Ref<() => void>;
  course: TeacherCourse;
  module: TeacherCourseModule;
  moduleIndex: number;
  lesson: TeacherLesson;
  lessonIndex: number;
  isEditable: boolean;
  isFreePreview: boolean;
  // Vem do estado do builder, nao de `course`: a estrategia pode ter mudado
  // na tela e ainda nao ter voltado do banco.
  dripStrategy: DripStrategy;
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

type BunnyProcessing = {
  assetId: string;
  status: number | null;
  encodeProgress: number | null;
  lengthSeconds: number | null;
};

// Bunny "Get Video" status: 0-3 still processing, 4 finished, 5 error,
// 6 upload failed, 7 JIT segmenting (not playable yet), 8 JIT playlists
// created (plays). Only 4 and 8 are ready; everything else that is not a
// failure keeps polling.
function isBunnyFailed(status: number | null) {
  return status === 5 || status === 6;
}
function isBunnyReady(status: number | null) {
  return status === 4 || status === 8;
}
// Ready but no length yet: Bunny can report the length a little later. Keep
// asking so the duration still gets written, but never forever.
const MAX_READY_POLLS_WITHOUT_LENGTH = 30;
// 5xx, 429 or a network error in a row (about 5 min at 10 s): a deleted video
// or a rotated key would otherwise retry forever. Any answer resets it.
const MAX_FAILED_POLLS_IN_A_ROW = 30;

// O link digitado e ainda nao gravado (sem blur) vai antes de fechar. Link
// recusado ou troca nao confirmada seguram o modal aberto, com o erro ou o
// aviso na tela: fechar calado perdia o que o professor digitou.
function flushLinkAllowsClose(handle: LessonVideoSourcePickerHandle | null) {
  const result = handle?.flushLink();
  return result !== "rejected" && result !== "declined";
}

const lessonModalTabs: Array<{
  value: LessonModalTab;
  icon: LucideIcon;
}> = [
  { value: "video", icon: Film },
  { value: "description", icon: FileText },
  { value: "materials", icon: UploadCloud },
  { value: "settings", icon: Settings },
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
  dripStrategy,
  onClose,
  onSetFreePreview,
  onUpdateLesson,
  leaveFlushRef,
  variant = "dialog",
  crumbs,
  onUploadingChange,
  onAssetsChanged,
}: LessonContentModalProps) {
  const { t } = useTranslation();
  const uploadManager = useLessonUpload();
  const sharedUpload = uploadManager?.job?.courseId === course.id && uploadManager.job.lessonId === lesson.id ? uploadManager.job : null;
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [tab, setTab] = useState<LessonModalTab>("video");
  // Decidido uma vez ao abrir a aula (o builder monta uma instancia por aula):
  // se dependesse do valor vivo, apagar a nota desmontava o campo no mesmo
  // toque e o professor nao conseguia desfazer.
  const [hadOldNote] = useState(() => Boolean(lesson.description?.trim()));
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const [uploadKind, setUploadKind] = useState<CourseAssetKind>("lesson_video");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isPreviewAsset, setIsPreviewAsset] = useState(false);
  const [localUploading, setIsUploading] = useState(false);
  const isUploading = localUploading || lessonUploadIsBusy(sharedUpload);
  // Guarda o cancelador entregue pelo uploader enquanto o envio corre.
  const [localCancelUpload, setCancelUpload] = useState<(() => void) | null>(null);
  const cancelUpload = sharedUpload
    ? sharedUpload.status === "uploading" && sharedUpload.canCancel ? cancelLessonUpload : null
    : localCancelUpload;
  const [localUploadProgress, setUploadProgress] = useState<UploadCourseAssetProgress | null>(null);
  const uploadProgress = sharedUpload?.progress ?? localUploadProgress;
  const [error, setError] = useState<LessonError | null>(null);
  const [success, setSuccess] = useState<"uploaded" | "deleted" | "oldLinkRemoved" | null>(null);
  const completedAssetId = sharedUpload?.status === "success" ? sharedUpload.assetId : undefined;
  const [handledAssetId, setHandledAssetId] = useState<string | undefined>();
  if (completedAssetId && completedAssetId !== handledAssetId) {
    setHandledAssetId(completedAssetId);
    setError(null);
    setSelectedFile(null);
    setUploadProgress(null);
    setIsPreviewAsset(false);
    setFileInputKey((current) => current + 1);
    setSuccess("uploaded");
  }
  const notifiedAssetRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!completedAssetId || notifiedAssetRef.current === completedAssetId) return;
    notifiedAssetRef.current = completedAssetId;
    onAssetsChanged?.();
  }, [completedAssetId, onAssetsChanged]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  // Latest Bunny processing answer for the lesson video, and the asset whose
  // duration was already written (only once per video).
  const [bunnyProcessing, setBunnyProcessing] = useState<BunnyProcessing | null>(null);
  // Asset whose status checks gave up after too many failures in a row.
  const [bunnyUnavailableFor, setBunnyUnavailableFor] = useState<string | null>(null);
  const durationWrittenForRef = useRef<string | null>(null);
  // Estado proprio, fora de `error`: resetUploadState (troca de aba ou de
  // modo) limpava o erro de carga e o aviso do link voltava a "Loading...".
  const [assetsLoadFailed, setAssetsLoadFailed] = useState(false);
  // "Replace with upload" antes de os arquivos chegarem: a fonte so pode ser
  // decidida quando se sabe se ha envio.
  const uploadChosenBeforeLoadRef = useRef(false);
  const replaceButtonRef = useRef<HTMLButtonElement>(null);
  const linkHandleRef = useRef<LessonVideoSourcePickerHandle>(null);
  // O fim do envio chama a versao mais recente do callback: a URL pode ter
  // mudado desde o comeco (voltar do navegador) e o builder decide com a atual.
  const uploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    uploadingChangeRef.current = onUploadingChange;
  });
  useImperativeHandle(leaveFlushRef, () => () => {
    linkHandleRef.current?.flushLink({ silent: true });
  });
  // Contador, nao booleano: cada recusa vira um no novo no role="status" e e
  // anunciada de novo. null = sem aviso.
  const [linkNotSaved, setLinkNotSaved] = useState<number | null>(null);
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
  const isUploadPanelOpen = resolvedSource === "upload" || selectedFile !== null || success === "uploaded" || lessonUploadIsBusy(sharedUpload);
  // Um video por aula: a aba mostra OU o envio OU o link. A aba abre como
  // resolveLessonVideoSource decide (aula que hoje tem os dois continua como
  // esta) e essa escolha e fixada UMA vez, quando os arquivos da aula chegam.
  // Rederivar a cada render tirava o campo de link da tela no meio da
  // digitacao quando o professor o apagava. A troca e explicita e nao apaga nada.
  const [videoModeChoice, setVideoModeChoice] = useState<LessonVideoMode | null>(null);
  const derivedVideoMode: LessonVideoMode = resolvedSource === "youtube" ? "link" : "upload";
  if (assetsLoaded && videoModeChoice === null) {
    setVideoModeChoice(derivedVideoMode);
  }
  const videoMode = videoModeChoice ?? derivedVideoMode;
  // Link antigo que nao e video (Drive etc.): so leitura, com botao de tirar.
  // O aluno continua com o botao "Open resource".
  const oldLink = lesson.externalUrl?.trim() && !trustedEmbed ? lesson.externalUrl : null;
  const videoStatus = tab === "video" && isUploading
    ? t("creatorEditor.lesson.file.uploading")
    : tab === "video" && selectedFile
      ? t("creatorEditor.lesson.file.selected")
      : t(`creatorEditor.lesson.state.${getAssetStatus(lessonAssets, lesson)}`);
  // So vale antes da primeira carga boa: depois dela, um recarregamento em
  // tempo real que falha deixava o alerta fixo ao lado de uma lista que
  // continua na tela.
  const loadErrorMessage = assetsLoadFailed && !assetsLoaded ? getLessonErrorMessage({ kind: "load" }, t) : "";
  const errorMessage = error ? getLessonErrorMessage(error, t) : loadErrorMessage;
  const successMessage = success ? t(`creatorEditor.lesson.success.${success}`) : "";

  const dialogRef = useRef<HTMLElement>(null);

  useModalFocus(dialogRef, variant === "dialog");

  // Closing mid-upload would drop the progress UI while bytes are still
  // flying — every close affordance funnels through requestClose so an
  // in-flight upload can't be dismissed by accident.
  function requestClose() {
    if (isUploading) {
      return;
    }

    if (!flushLinkAllowsClose(linkHandleRef.current)) {
      return;
    }
    onClose();
  }

  useEffect(() => {
    return subscribeToCourseAssets(
      course.id,
      (next) => {
        setAssets(next);
        setAssetsLoaded(true);
        setAssetsLoadFailed(false);
      },
      () => setAssetsLoadFailed(true),
    );
  }, [course.id]);

  // O professor escolheu o envio antes de os arquivos chegarem: com eles na
  // mao e um envio salvo, a fonte vai para "upload", para o aluno ver o que o
  // estudio mostra. Se a carga falha, nada e gravado.
  useEffect(() => {
    if (!assetsLoaded || !uploadChosenBeforeLoadRef.current) {
      return;
    }
    uploadChosenBeforeLoadRef.current = false;
    if (primaryVideo && lesson.videoSource !== "upload") {
      onUpdateLesson({ videoSource: "upload" });
    }
  }, [assetsLoaded, primaryVideo, lesson.videoSource, onUpdateLesson]);

  // Video on Bunny: ask for its processing state every 10 s until it is ready
  // or failed. Stops when the studio closes (unmount) or the video changes.
  const bunnyAssetId = resolvedSource === "upload" && primaryVideo?.bunnyVideoId ? primaryVideo.id : null;
  useEffect(() => {
    if (!bunnyAssetId) {
      return;
    }
    const assetId = bunnyAssetId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let readyPollsWithoutLength = 0;
    let failedPollsInARow = 0;

    async function poll() {
      let failed = false;
      try {
        const response = await fetch(`/api/teach/video/status?assetId=${encodeURIComponent(assetId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as Omit<BunnyProcessing, "assetId">;
          if (controller.signal.aborted) {
            return;
          }
          failedPollsInARow = 0;
          setBunnyProcessing({ assetId, ...data });
          if (isBunnyFailed(data.status)) {
            return;
          }
          if (
            isBunnyReady(data.status)
            && (data.lengthSeconds || ++readyPollsWithoutLength > MAX_READY_POLLS_WITHOUT_LENGTH)
          ) {
            return;
          }
        } else if (response.status < 500 && response.status !== 429) {
          // Signed out, not the owner, or gone: asking again will not help.
          // Too many checks (429) and 5xx try again in 10 s.
          return;
        } else {
          failed = true;
        }
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        failed = true;
      }
      if (failed && ++failedPollsInARow > MAX_FAILED_POLLS_IN_A_ROW) {
        setBunnyUnavailableFor(assetId);
        return;
      }
      timer = setTimeout(poll, 10_000);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bunnyAssetId]);

  // Duration: the first answer that shows the video ready with a length writes
  // the minutes (rounded up, at least 1), only if they changed. The normal
  // autosave takes it to the database.
  useEffect(() => {
    const answer = bunnyProcessing;
    if (
      !answer || !isBunnyReady(answer.status) || !answer.lengthSeconds
      || durationWrittenForRef.current === answer.assetId
    ) {
      return;
    }
    durationWrittenForRef.current = answer.assetId;
    const minutes = Math.max(1, Math.ceil(answer.lengthSeconds / 60));
    if (lesson.durationMinutes !== minutes) {
      onUpdateLesson({ durationMinutes: minutes });
    }
  }, [bunnyProcessing, lesson.durationMinutes, onUpdateLesson]);

  const processing = bunnyProcessing?.assetId === primaryVideo?.id ? bunnyProcessing : null;
  const bunnyStatusLine = bunnyUnavailableFor !== null && bunnyUnavailableFor === primaryVideo?.id
    ? t("creatorEditor.lesson.videoStatusUnavailable")
    : !processing || processing.status === null
    ? t("creatorEditor.lesson.savedProcessing")
    : isBunnyFailed(processing.status)
      ? t("creatorEditor.lesson.videoFailed")
      : isBunnyReady(processing.status)
        ? t("creatorEditor.lesson.videoReady")
        : t("creatorEditor.lesson.videoProcessing")
          .replace("{percent}", () => String(processing.encodeProgress ?? 0));

  // The parent mounts this modal conditionally, so it is always "open" while
  // mounted — Escape mirrors the close affordances (X button / Done / overlay).
  // Re-binding when isUploading flips is what keeps Escape from dismissing an
  // in-flight upload, matching requestClose below.
  useEffect(() => {
    // Na pagina nao ha o que fechar com Esc: o voltar e a trilha fazem isso.
    if (variant === "page") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUploading && flushLinkAllowsClose(linkHandleRef.current)) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isUploading, onClose, variant]);

  // Na pagina, o voltar do navegador desmonta so esta pagina (o builder fica):
  // o link digitado e ainda sem blur e gravado antes, sem perguntar. Efeito de
  // layout porque roda antes de o React soltar o handle do seletor (filho).
  useLayoutEffect(() => {
    if (variant !== "page") {
      return;
    }
    const handleRef = linkHandleRef;
    return () => {
      handleRef.current?.flushLink({ silent: true });
    };
  }, [variant]);

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
    setLinkNotSaved(null);

    if (nextTab === "video") {
      resetUploadState("lesson_video");
    }

    if (nextTab === "materials") {
      resetUploadState("lesson_material");
    }

    if (nextTab === "description" || nextTab === "settings") {
      resetUploadState("lesson_thumbnail");
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable || !selectedFile || isUploading) {
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
    onUploadingChange?.(true);

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
    let failed = false;

    try {
      if (uploadManager) {
        await startLessonUpload({
          actorId: uploadManager.actorId, courseId: course.id, ownerId: course.ownerId,
          lessonId: lesson.id, moduleId: module.id, kind: uploadKind,
          file: selectedFile, isPreview: uploadAsPreview, useBunny,
        });
      } else if (useBunny) {
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
      if (!mountedRef.current) return;
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
      if (!uploadManager) onAssetsChanged?.();
    } catch (caughtError) {
      if (!mountedRef.current) return;
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
        failed = true;
        setError({ kind: "upload", cause: caughtError, limitBytes: useBunny ? bunnyVideoMaxBytes : supabaseUploadLimitBytes });
      }
    } finally {
      if (mountedRef.current) {
        setCancelUpload(null);
        setIsUploading(false);
        uploadingChangeRef.current?.(false, failed);
      }
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
      onAssetsChanged?.();
    } catch {
      setError({ kind: "delete" });
    } finally {
      setDeletingAssetId(null);
    }
  }

  const isPage = variant === "page";

  // Sair pela trilha passa pelo mesmo cuidado de fechar: envio no ar segura, o
  // link digitado vai antes, e link recusado ou nao confirmado segura na tela.
  function guardLeave(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (isUploading || !flushLinkAllowsClose(linkHandleRef.current)) {
      event.preventDefault();
    }
  }

  const content = (
      <section
        ref={dialogRef}
        tabIndex={-1}
        aria-modal={isPage ? undefined : "true"}
        aria-labelledby="lesson-modal-title"
        className={isPage ? "lesson-modal lesson-modal--page" : "lesson-modal"}
        role={isPage ? undefined : "dialog"}
        onMouseDown={isPage ? undefined : (event) => event.stopPropagation()}
      >
        {isPage && crumbs ? (
          <nav className="lesson-modal__header" aria-label={t("creatorEditor.builder.curriculum.breadcrumb")}>
            <ol className="lesson-modal__trail">
              <li>
                <Link
                  href={crumbs.courseHref}
                  scroll={false}
                  onClick={(event) => {
                    guardLeave(event);
                    // So o clique simples navega nesta aba (ctrl/cmd abrem outra).
                    if (
                      !event.defaultPrevented
                      && event.button === 0
                      && !event.metaKey
                      && !event.ctrlKey
                      && !event.shiftKey
                      && !event.altKey
                    ) {
                      crumbs.onCourseNavigate?.();
                    }
                  }}
                >
                  {crumbs.courseLabel}
                </Link>
              </li>
              <li>
                <Link href={crumbs.moduleHref} scroll={false} onClick={guardLeave}>
                  {crumbs.moduleLabel}
                </Link>
              </li>
              <li aria-current="page">{lesson.title || t("creatorEditor.lesson.untitled")}</li>
            </ol>
          </nav>
        ) : (
          <header className="lesson-modal__header">
            <p className="lesson-modal__crumb">{t("creatorEditor.lesson.number").replace("{lessonIndex}", () => String(lessonIndex + 1))}</p>
            <button type="button" className="lesson-modal__close" onClick={requestClose}>
              <X aria-hidden="true" size={18} />
              <span className="sr-only">{t("creatorEditor.lesson.close")}</span>
            </button>
          </header>
        )}

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
            <h3 id="lesson-modal-title" tabIndex={-1}>{lesson.title || t("creatorEditor.lesson.untitled")}</h3>
            <p className="lesson-modal__crumb">
              {t("creatorEditor.lesson.context")
                .replace("{moduleIndex}", () => String(moduleIndex + 1))
                .replace("{lessonIndex}", () => String(lessonIndex + 1))
                .replace("{moduleTitle}", () => module.title)}
            </p>
          </div>
          {tab === "video" ? (
            <div className="grid gap-5">

              <LessonVideoSourcePicker
                mode={videoMode}
                disabled={!isEditable || isUploading}
                accept={courseAssetAcceptTypes[uploadKind]}
                externalUrl={lesson.externalUrl ?? ""}
                embedStatus={
                  trustedEmbed
                    ? t("creatorEditor.lesson.embedDetected").replace("{provider}", () => trustedEmbed.provider === "youtube" ? "YouTube" : "Vimeo")
                    : t("creatorEditor.lesson.embedEmpty")
                }
                replaceButtonRef={replaceButtonRef}
                linkHandleRef={linkHandleRef}
                // Sem os arquivos da aula nao da para saber se ha envio: apagar
                // o link agora gravaria a fonte em null com um envio salvo.
                linkLockedHint={assetsLoaded
                  ? undefined
                  : loadErrorMessage || t("creatorEditor.lesson.linkLoading")}
                onModeChange={(next) => {
                  setVideoModeChoice(next);
                  uploadChosenBeforeLoadRef.current = next === "upload" && !assetsLoaded;
                  setLinkNotSaved(null);
                  resetUploadState("lesson_video");
                  // Se a midia de destino ja existe, a troca vale para o aluno
                  // na hora: grava so a fonte. Nada e apagado. Sem midia, a
                  // troca fica so na tela ate um link ser aceito ou um envio
                  // terminar. Antes de os arquivos chegarem o modo link e so o
                  // plano B da tela (nao se sabe se ha envio): gravar "youtube"
                  // ali tirava o aluno do envio numa ida e volta sem efeito.
                  if (next === "link" && assetsLoaded && trustedEmbed && lesson.videoSource !== "youtube") {
                    onUpdateLesson({ videoSource: "youtube" });
                  }
                  if (next === "upload" && primaryVideo && lesson.videoSource !== "upload") {
                    onUpdateLesson({ videoSource: "upload" });
                  }
                }}
                // Fonte e link numa gravacao so, e so com link aceito. Nenhum
                // course_assets e apagado aqui: o envio antigo segue na lista.
                onLinkChange={(nextUrl, options) => {
                  // Mexeu no link: a aba fica no link mesmo que a fonte mude.
                  setVideoModeChoice("link");
                  if (!nextUrl) {
                    setLinkNotSaved(null);
                    // Com envio salvo, a fonte volta para ele: a pagina publica
                    // do curso so le "upload" da fonte gravada
                    // (creator-course-detail), e o video da previa gratis
                    // sumia da pagina de vendas com a fonte em null.
                    const source = primaryVideo
                      ? "upload"
                      : lesson.videoSource === "youtube" ? null : lesson.videoSource;
                    onUpdateLesson({
                      externalUrl: null,
                      ...(source !== lesson.videoSource ? { videoSource: source } : {}),
                    });
                    return;
                  }
                  // O link aceito substitui o link antigo (Drive etc.): pede a
                  // mesma confirmacao do botao de tirar. Recusou, nada muda e
                  // o campo volta ao salvo.
                  // Saindo da pagina (silent) nao da para perguntar: nao grava.
                  if (oldLink && (options?.silent || !window.confirm(t("creatorEditor.lesson.removeOldLinkConfirm")))) {
                    setLinkNotSaved((count) => (count ?? 0) + 1);
                    return false;
                  }
                  setLinkNotSaved(null);
                  onUpdateLesson({ videoSource: "youtube", externalUrl: nextUrl });
                }}
                onSelectFile={(file) => {
                  setSelectedFile(file);
                  setUploadProgress(null);
                  setSuccess(null);
                  setError(null);
                }}
                uploadPanel={isUploadPanelOpen ? (
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
                    progressPercent={uploadProgress?.percent}
                    onCancel={cancelUpload}
                    selectedFile={selectedFile}
                    fileInputKey={fileInputKey}
                    success={successMessage}
                    uploadKind={uploadKind}
                    onKindChange={setUploadKind}
                  />
                ) : undefined}
              />

              {oldLink ? (
                <section
                  aria-label={t("creatorEditor.lesson.oldLink")}
                  className="grid gap-2 rounded-[12px] border border-[var(--color-line)] p-3 text-sm"
                >
                  <p className="font-semibold">{t("creatorEditor.lesson.oldLink")}</p>
                  <p className="break-all text-[var(--color-ink-soft)]">{oldLink}</p>
                  <p className="text-xs text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.oldLinkHelp")}</p>
                  <button
                    type="button"
                    className="button-outline justify-self-start px-3 py-2 text-xs disabled:opacity-60"
                    // Durante o envio o botao de troca fica desabilitado: o
                    // foco nao teria para onde ir e o aviso se perdia.
                    disabled={!isEditable || isUploading}
                    onClick={() => {
                      if (window.confirm(t("creatorEditor.lesson.removeOldLinkConfirm"))) {
                        onUpdateLesson({ externalUrl: null });
                        // Esta secao some junto com o link: o foco vai para um
                        // botao que fica, e o aviso sai pelo role="status".
                        setSuccess("oldLinkRemoved");
                        setLinkNotSaved(null);
                        replaceButtonRef.current?.focus();
                      }
                    }}
                  >
                    {t("creatorEditor.lesson.removeOldLink")}
                  </button>
                </section>
              ) : null}

              {/* Com o formulario de envio na tela, o role="status" dele da o
                  aviso; sem ele, este. Nunca dois ao mesmo tempo. O erro de
                  carga aparece aqui so no modo envio: no modo link ele ja sai
                  no proprio campo. */}
              {videoMode === "upload" && isUploadPanelOpen ? null : (
                <p role="status" className="text-sm text-[var(--color-ink-soft)]">
                  {success === "oldLinkRemoved"
                    ? successMessage
                    : linkNotSaved
                      ? <span key={linkNotSaved}>{t("creatorEditor.lesson.linkNotSaved")}</span>
                      : videoMode === "upload" ? loadErrorMessage : ""}
                </p>
              )}

              {videoAssets.length > 0 ? (
                  <LessonAssetList
                    assets={videoAssets}
                    emptyLabel={t("creatorEditor.lesson.noVideo")}
                    isEditable={isEditable}
                    deletingAssetId={deletingAssetId}
                    onDelete={handleDeleteAsset}
                  />
              ) : null}

              {resolvedSource ? (
                <section aria-label={t("creatorEditor.lesson.previewLabel")} className="grid min-w-0 gap-2">
                  <h4 className="text-sm font-semibold">{t("creatorEditor.lesson.previewTitle")}</h4>
                  {resolvedSource === "upload" && primaryVideo ? (
                    primaryVideo.bunnyVideoId ? (
                      <>
                        <BunnyVideoPlayer key={primaryVideo.id} assetId={primaryVideo.id} title={lesson.title} />
                        <p className="text-sm text-[var(--color-ink-soft)]">
                          {bunnyStatusLine}
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
              {/* Um campo so, em texto simples, no campo PROTEGIDO (contentText:
                  course_lesson_content, fora do JSON publico). Links viram
                  clicaveis na area de membros (decisao de 14/09). */}
              <label className="lesson-modal-field">
                <span>
                  {t("creatorEditor.lesson.description")}
                  {/* A aula de previa gratis tem o texto lido por qualquer um
                      na pagina do curso: "so inscritos" enganaria o professor. */}
                  <small>
                    {t(isFreePreview
                      ? "creatorEditor.lesson.descriptionHelpPreview"
                      : "creatorEditor.lesson.descriptionHelp")}
                  </small>
                </span>
                <textarea
                  value={lesson.contentText ?? ""}
                  onChange={(event) => onUpdateLesson({ contentText: event.target.value || null })}
                  disabled={!isEditable}
                  rows={7}
                  placeholder={t("creatorEditor.lesson.descriptionPlaceholder")}
                />
              </label>
              {/* A descricao publica antiga nunca e apagada: fica recolhida e
                  editavel, e o aluno continua vendo onde ja via. */}
              {hadOldNote ? (
                <details className="lesson-modal-field">
                  <summary>{t("creatorEditor.lesson.oldNote")}</summary>
                  <textarea
                    value={lesson.description}
                    onChange={(event) => onUpdateLesson({ description: event.target.value })}
                    disabled={!isEditable}
                    rows={3}
                    aria-label={t("creatorEditor.lesson.oldNote")}
                  />
                </details>
              ) : null}
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
                progressPercent={uploadProgress?.percent}
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
                progressPercent={uploadProgress?.percent}
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
              {/* So a estrategia "time_drip_custom" le os dias por aula
                  (src/domain/drip-policy.ts); nas outras o campo nao faz nada. */}
              {dripStrategy === "time_drip_custom" ? (
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
              ) : null}
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
  );

  return isPage ? content : (
    <div className="lesson-modal-overlay" role="presentation" onMouseDown={requestClose}>
      {content}
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
  progressPercent,
  selectedFile,
  success,
  uploadKind,
  onKindChange,
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
  progressPercent?: number | null;
  selectedFile: File | null;
  success: string;
  uploadKind: CourseAssetKind;
  onKindChange?: (kind: CourseAssetKind) => void;
}) {
  const { t } = useTranslation();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [unpreviewableFile, setUnpreviewableFile] = useState<File | null>(null);
  const isVideo = isVideoAssetKind(uploadKind);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !selectedFile?.type.startsWith("video/")) return;
    // Blob URLs stream the local file without uploading or reading it all into RAM.
    const url = URL.createObjectURL(selectedFile);
    video.src = url;
    return () => {
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [selectedFile]);

  return (
    <form
      className="lesson-modal-upload"
      onSubmit={onSubmit}
      onDragOver={(event) => { if (isVideo) event.preventDefault(); }}
      onDrop={(event) => {
        if (!isVideo) return;
        event.preventDefault();
        if (!isEditable || isUploading) return;
        const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("video/"));
        if (file) onFileChange(file);
      }}
    >
      {selectedFile ? (
        <p className="lesson-modal-upload__file">
          {selectedFile.name} - {formatCourseAssetSize(selectedFile.size)}
        </p>
      ) : null}
      {error ? <p role="alert" className="lesson-modal-upload__error">{error}</p> : null}
      <p role="status" className={success ? "lesson-modal-upload__success" : "text-sm text-[var(--color-ink-soft)]"}>
        {isUploading ? progressLabel || t("creatorEditor.lesson.file.uploading")
          : success || (selectedFile ? t("creatorEditor.lesson.file.selectedHelp") : "")}
      </p>
      {isUploading ? (
        <div className="grid min-w-0 gap-2">
          <progress className="h-2 w-full accent-[var(--color-ink)]" max={100} value={progressPercent ?? undefined} aria-label={t("creatorEditor.lesson.file.uploading")} />
          {onCancel ? (
            <button type="button" onClick={onCancel} className="button-outline min-h-11 px-3 text-sm">
              {t("creatorEditor.lesson.file.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        autoFocus={isVideo && Boolean(selectedFile)}
        disabled={!isEditable || isUploading || !selectedFile}
        className="button-solid min-h-11 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {t(`creatorEditor.lesson.file.${isUploading ? "uploading" : "upload"}`)}
      </button>
      {isVideo && selectedFile?.type.startsWith("video/") ? (
        <>
          <video
            ref={localVideoRef}
            controls
            playsInline
            preload="metadata"
            aria-label={t("creatorEditor.lesson.file.localPreview")}
            className="aspect-video max-h-48 w-full rounded-md bg-black object-contain"
            hidden={unpreviewableFile === selectedFile}
            onError={() => setUnpreviewableFile(selectedFile)}
          />
          {unpreviewableFile === selectedFile ? (
            <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.file.previewUnavailable")}</p>
          ) : null}
        </>
      ) : null}
      <label>
        <span>{getCourseAssetKindLabel(uploadKind, t)}</span>
        <input
          key={`${fileInputKey}-${uploadKind}`}
          type="file"
          accept={courseAssetAcceptTypes[uploadKind]}
          disabled={!isEditable || isUploading}
          aria-label={getCourseAssetKindLabel(uploadKind, t)}
          onChange={(event) => {
            onFileChange(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
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
      {onKindChange ? (
        <label className="lesson-modal-field">
          <span>{t("creatorEditor.lesson.file.videoType")}</span>
          <select value={uploadKind} disabled={!isEditable || isUploading}
            onChange={(event) => onKindChange(event.target.value as "lesson_video" | "live_recording")}>
            <option value="lesson_video">{getCourseAssetKindLabel("lesson_video", t)}</option>
            <option value="live_recording">{getCourseAssetKindLabel("live_recording", t)}</option>
          </select>
        </label>
      ) : null}
      <label className="lesson-modal-upload__preview">
        <input
          type="checkbox"
          checked={isPreviewAsset}
          disabled={!isEditable || isUploading}
          onChange={(event) => onChangePreview(event.target.checked)}
        />
        {t("creatorEditor.lesson.file.allowPreview")}
      </label>
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
