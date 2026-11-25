"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import {
  ArrowDown,
  ArrowUp,
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
import { Button } from "@/components/ui/button";
import { BusyLabel } from "@/components/ui/busy-label";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import { TrustedEmbedPlayer } from "@/components/learn/trusted-embed-player";
import { ProtectedAssetPreview } from "@/components/shared/protected-asset-preview";
import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  bunnyVideoMaxBytes,
  courseAssetAcceptTypes,
  courseAssetTitleMaxLength,
  formatCourseAssetSize,
  getCourseAssetTitle,
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
  renameCourseAsset,
  saveCourseAssetOrder,
  subscribeToCourseAssets,
  uploadCourseAsset,
  uploadLessonVideoToBunny,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";
import { isBunnyConfigured } from "@/lib/bunny/config";
import { isTeacherAiEnabled } from "@/lib/ai/config";
import { LessonAiCaptions } from "@/components/teacher/lesson-ai-captions";
import { LessonAiQuiz } from "@/components/teacher/lesson-ai-quiz";
import { AiSuggest } from "@/components/teacher/ai-suggest";
import { useConfirm } from "@/components/teacher/use-confirm";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useLessonUpload, startLessonUpload, cancelLessonUpload } from "@/components/teacher/lesson-upload-provider";
import { lessonUploadIsBusy } from "@/lib/data/lesson-upload";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";

type LessonContentModalProps = {
  // "page": the studio body on the builder's own page (?lesson=L), with no dark
  // layer, no focus trap and no Esc to close; the Course > Module > Lesson
  // breadcrumb takes the place of the header.
  variant?: "dialog" | "page";
  crumbs?: {
    courseLabel: string;
    courseHref: string;
    moduleLabel: string;
    moduleHref: string;
    // Leaving through the course breadcrumb: the builder remembers where to
    // return focus.
    onCourseNavigate?: () => void;
  };
  // Upload in progress: the builder keeps this page mounted until the upload
  // ends, even if the URL changes (browser back, another tab).
  onUploadingChange?: (uploading: boolean, failed?: boolean) => void;
  // File uploaded or deleted: the builder fetches the course list again, and the
  // Publish readiness sees what changed.
  onAssetsChanged?: () => void;
  // Builder leaving the page: saves, without a prompt, the typed link that has no
  // blur yet.
  leaveFlushRef?: Ref<() => void>;
  // E-book: only the lesson's file list, with no breadcrumb, tabs, video or
  // "Done". The buyer downloads the file in that lesson, which the creator does
  // not see.
  filesOnly?: boolean;
  course: TeacherCourse;
  module: TeacherCourseModule;
  moduleIndex: number;
  lesson: TeacherLesson;
  lessonIndex: number;
  isEditable: boolean;
  isFreePreview: boolean;
  // Comes from the builder's state, not from `course`: the strategy may have
  // changed on screen and not yet come back from the database.
  dripStrategy: DripStrategy;
  onClose: () => void;
  onSetFreePreview: () => void;
  onUpdateLesson: (patch: Partial<TeacherLesson>) => void;
};

type LessonModalTab = "video" | "description" | "materials" | "settings";
type LessonError =
  | { kind: "load" | "delete" | "save" }
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

// The typed link that is not yet saved (no blur) goes out before closing. A
// rejected link or an unconfirmed swap keeps the modal open, with the error or
// the notice on screen: closing silently lost what the teacher typed.
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

  // With no percentage from the transport (Supabase Storage), it does not invent
  // "0%".
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
  filesOnly = false,
}: LessonContentModalProps) {
  const { t } = useTranslation();
  const { ask, asking, dialog: confirmDialog } = useConfirm();
  const uploadManager = useLessonUpload();
  const sharedUpload = uploadManager?.job?.courseId === course.id && uploadManager.job.lessonId === lesson.id ? uploadManager.job : null;
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [tab, setTab] = useState<LessonModalTab>(filesOnly ? "materials" : "video");
  // Decided once when the lesson opens (the builder mounts one instance per
  // lesson): if it depended on the live value, clearing the note would unmount
  // the field on the same tap and the teacher could not undo it.
  const [hadOldNote] = useState(() => Boolean(lesson.description?.trim()));
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const [uploadKind, setUploadKind] = useState<CourseAssetKind>(filesOnly ? "lesson_material" : "lesson_video");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [localUploading, setIsUploading] = useState(false);
  const isUploading = localUploading || lessonUploadIsBusy(sharedUpload);
  // Holds the canceller handed over by the uploader while the upload runs.
  const [localCancelUpload, setCancelUpload] = useState<(() => void) | null>(null);
  const cancelUpload = sharedUpload
    ? sharedUpload.status === "uploading" && sharedUpload.canCancel ? cancelLessonUpload : null
    : localCancelUpload;
  const [localUploadProgress, setUploadProgress] = useState<UploadCourseAssetProgress | null>(null);
  const uploadProgress = sharedUpload?.progress ?? localUploadProgress;
  const [error, setError] = useState<LessonError | null>(null);
  const [success, setSuccess] = useState<"uploaded" | "deleted" | "oldLinkRemoved" | "ordered" | null>(null);
  // "Name saved." (or the failure) shows below the renamed field: before, it
  // landed in the upload box, above the list, far from the file that changed.
  const [renameNotice, setRenameNotice] = useState<{ assetId: string; failed: boolean } | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const completedAssetId = sharedUpload?.status === "success" ? sharedUpload.assetId : undefined;
  const [handledAssetId, setHandledAssetId] = useState<string | undefined>();
  if (completedAssetId && completedAssetId !== handledAssetId) {
    setHandledAssetId(completedAssetId);
    setError(null);
    setSelectedFile(null);
    setUploadProgress(null);
    setFileInputKey((current) => current + 1);
    setSuccess("uploaded");
  }
  // Reload of this lesson's file list. course_assets is not in the Realtime
  // publication: without fetching again, the file the teacher had just uploaded
  // only showed up after reloading the page.
  const assetsReloadRef = useRef<(() => Promise<void>) | null>(null);
  const notifiedAssetRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!completedAssetId || notifiedAssetRef.current === completedAssetId) return;
    notifiedAssetRef.current = completedAssetId;
    void assetsReloadRef.current?.();
    onAssetsChanged?.();
  }, [completedAssetId, onAssetsChanged]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  // Latest Bunny processing answer for the lesson video, and the asset whose
  // duration was already written (only once per video).
  const [bunnyProcessing, setBunnyProcessing] = useState<BunnyProcessing | null>(null);
  // Asset whose status checks gave up after too many failures in a row.
  const [bunnyUnavailableFor, setBunnyUnavailableFor] = useState<string | null>(null);
  const durationWrittenForRef = useRef<string | null>(null);
  // Own state, outside `error`: resetUploadState (switching tab or mode) cleared
  // the load error and the link notice went back to "Loading...".
  const [assetsLoadFailed, setAssetsLoadFailed] = useState(false);
  // "Replace with upload" before the files arrive: the source can only be decided
  // once it is known whether an upload exists.
  const uploadChosenBeforeLoadRef = useRef(false);
  const replaceButtonRef = useRef<HTMLButtonElement>(null);
  const linkHandleRef = useRef<LessonVideoSourcePickerHandle>(null);
  // The end of the upload calls the latest version of the callback: the URL may
  // have changed since the start (browser back) and the builder decides with the
  // current one.
  const uploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    uploadingChangeRef.current = onUploadingChange;
  });
  useImperativeHandle(leaveFlushRef, () => () => {
    linkHandleRef.current?.flushLink({ silent: true });
  });
  // A counter, not a boolean: each refusal becomes a new node in the
  // role="status" and is announced again. null = no notice.
  const [linkNotSaved, setLinkNotSaved] = useState<number | null>(null);
  // Goes up when the swap of the old link is confirmed in the dialog: it remounts
  // the picker, which starts out showing the saved link. The field had gone back
  // to the saved value ("") when asking; without this it stayed empty and the
  // next blur erased the freshly saved link.
  const [linkReplaced, setLinkReplaced] = useState(0);
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
  // The upload panel opens by the teacher's INTENT (they chose a file), not by
  // the persisted field. These are two different questions that `videoSource` was
  // answering alone: "which editor do I show now" and "which player does the
  // learner get". Tying the first to the saved field made the only upload path
  // unreachable on a new lesson — the source only becomes "upload" when the
  // upload succeeds, and the upload only showed up if the source was already
  // "upload".
  const isUploadPanelOpen = resolvedSource === "upload" || selectedFile !== null || success === "uploaded" || lessonUploadIsBusy(sharedUpload);
  // One video per lesson: the tab shows EITHER the upload OR the link. The tab
  // opens as resolveLessonVideoSource decides (a lesson that has both today stays
  // as it is) and that choice is fixed ONCE, when the lesson's files arrive.
  // Re-deriving on every render took the link field off screen in the middle of
  // typing when the teacher cleared it. The switch is explicit and deletes
  // nothing.
  const [videoModeChoice, setVideoModeChoice] = useState<LessonVideoMode | null>(null);
  const derivedVideoMode: LessonVideoMode = resolvedSource === "youtube" ? "link" : "upload";
  if (assetsLoaded && videoModeChoice === null) {
    setVideoModeChoice(derivedVideoMode);
  }
  const videoMode = videoModeChoice ?? derivedVideoMode;
  // Old link that is not a video (Drive etc.): read-only, with a remove button.
  // The learner keeps the "Open resource" button.
  const oldLink = lesson.externalUrl?.trim() && !trustedEmbed ? lesson.externalUrl : null;
  const assetStatus = getAssetStatus(lessonAssets, lesson);
  const videoBusy = tab === "video" && (isUploading || Boolean(selectedFile));
  const videoStatus = tab === "video" && isUploading
    ? t("creatorEditor.lesson.file.uploading")
    : tab === "video" && selectedFile
      ? t("creatorEditor.lesson.file.selected")
      : t(`creatorEditor.lesson.state.${assetStatus}`);
  // Only applies before the first good load: after it, a real-time reload that
  // fails left the alert stuck next to a list that is still on screen.
  const loadErrorMessage = assetsLoadFailed && !assetsLoaded ? getLessonErrorMessage({ kind: "load" }, t) : "";
  const errorMessage = error ? getLessonErrorMessage(error, t) : loadErrorMessage;
  const successMessage = success ? t(`creatorEditor.lesson.success.${success}`) : "";

  const dialogRef = useRef<HTMLElement>(null);

  useModalFocus(dialogRef, variant === "dialog");

  // F-11: the failure of the file list was a dead end, just the sentence. The
  // sentence stays where it is already announced (in the link field, in the
  // upload notice, in the upload form), so here comes only the way out: "Try
  // again" reads again through the same reload at the end of an upload. Focus
  // goes to the dialog first, because the button disappears when the list
  // arrives.
  const [retryingAssets, setRetryingAssets] = useState(false);
  async function retryAssets() {
    if (retryingAssets) return;
    dialogRef.current?.focus();
    setRetryingAssets(true);
    try {
      await assetsReloadRef.current?.();
    } finally {
      setRetryingAssets(false);
    }
  }
  const assetsRetry = loadErrorMessage ? (
    <Button
      variant="outline"
      className="justify-self-start"
      loading={retryingAssets}
      busyLabel={t("appErrors.retrying")}
      onClick={() => void retryAssets()}
    >
      {t("appErrors.retry")}
    </Button>
  ) : null;

  // Upload canceled on a lesson with no video: the upload card goes away with the
  // Cancel button focused and the drop area comes back. Focus goes to its field
  // instead of falling to the body. While the card is still on screen, it handles
  // focus itself.
  const refocusUploadRef = useRef(false);
  useEffect(() => {
    if (!refocusUploadRef.current || isUploading) return;
    refocusUploadRef.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    dialogRef.current?.querySelector<HTMLInputElement>('.lesson-video-source-picker input[type="file"]')?.focus();
  });

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
    const subscription = subscribeToCourseAssets(
      course.id,
      (next) => {
        setAssets(next);
        setAssetsLoaded(true);
        setAssetsLoadFailed(false);
      },
      () => setAssetsLoadFailed(true),
    );
    assetsReloadRef.current = subscription.reload;
    return () => {
      assetsReloadRef.current = null;
      subscription();
    };
  }, [course.id]);

  // The teacher chose the upload before the files arrived: with them in hand and
  // a saved upload, the source goes to "upload", so the learner sees what the
  // studio shows. If the load fails, nothing is saved.
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
    // On the page there is nothing to close with Esc: the back button and the
    // breadcrumb do that.
    if (variant === "page") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      // With the confirmation open, Esc belongs to it: it closes only the
      // question.
      if (event.key !== "Escape" || asking || isUploading) {
        return;
      }
      if (flushLinkAllowsClose(linkHandleRef.current)) {
        onClose();
        return;
      }
      // The flush held the studio (link rejected, or the swap question has just
      // opened). This same Esc is still being delivered: without preventDefault
      // the browser applied it to the newly opened dialog, which flashed and
      // closed before the teacher answered.
      event.preventDefault();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [asking, isUploading, onClose, variant]);

  // On the page, the browser back unmounts only this page (the builder stays):
  // the typed link that has no blur yet is saved first, without asking. A layout
  // effect because it runs before React releases the picker's handle (a child).
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
      // Split into two checks because isAllowedBunnyVideoFile rejects both type
      // and size: a 200 MB PDF got a message about the 5 GB cap, which has
      // nothing to do with the reason for the refusal.
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
      // Without Bunny the bytes go to Supabase Storage, and the validator already
      // refuses above the plan cap (~50 MB), not the bucket's — the separate size
      // branch that existed here became unreachable (#138).
      setError({ kind: "invalidFile", assetKind: uploadKind, limitBytes: supabaseUploadLimitBytes });
      return;
    }

    setIsUploading(true);
    onUploadingChange?.(true);

    // The video of a lesson marked as "free preview" MUST be uploaded with
    // is_preview, otherwise the public sales page does not find it: the anonymous
    // lookup at /api/courses/video-token filters by .eq("is_preview", true).
    //
    // Before, this depended on the creator also ticking a separate checkbox in
    // the video tab. Whoever ticked only the lesson toggle — the obvious path,
    // and the only one called "preview" — published with everything green in the
    // studio and saw "Video unavailable" in their own store, with no sign of what
    // was missing. Two questions for the same decision; now the lesson toggle
    // rules.
    //
    // The "Allow this file in the public preview" box is gone: no rule read
    // is_preview on materials (the private bucket's RLS only looks at enrollment
    // and a released lesson), so it marked "Preview" on a file that stayed
    // closed.
    const uploadAsPreview = isFreePreview && isVideoAssetKind(uploadKind);
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
          // setState with a function keeps the CALLBACK, not its result — hence
          // the wrapper: setCancelUpload(cancel) would treat `cancel` as an
          // updater.
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
      // The lesson source becomes "upload" HERE, and not when the file is chosen:
      // now there really is a video to play. Declaring it before the upload left
      // the lesson empty for the paying learner while the teacher read "Media is
      // connected." on their own screen.
      if (isVideoKind) {
        onUpdateLesson({ videoSource: "upload" });
      }
      setSuccess("uploaded");
      setSelectedFile(null);
      setUploadProgress(null);
      setFileInputKey((current) => current + 1);
      if (!uploadManager) {
        void assetsReloadRef.current?.();
        onAssetsChanged?.();
      }
    } catch (caughtError) {
      if (!mountedRef.current) return;
      // Cancel is a normal outcome, not a failure: it clears the screen with no
      // red box.
      if (caughtError instanceof CourseAssetUploadCancelled) {
        setUploadProgress(null);
        setSelectedFile(null);
        setFileInputKey((current) => current + 1);
        refocusUploadRef.current = true;
      } else {
        // Show the real blocker (413 size cap, 403 permission, ...) instead of a
        // generic message that made failures look random. And without leaving the
        // old progress on screen next to the red box.
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

  function handleDeleteAsset(asset: CourseAsset) {
    if (!isEditable) {
      return;
    }

    // The dialog waits for the delete to finish; the error shows on the page, as
    // before.
    ask({
      title: t("creatorEditor.lesson.deleteTitle"),
      body: t("creatorEditor.lesson.deleteConfirm").replace("{fileName}", () => asset.fileName),
      confirmLabel: t("creatorEditor.lesson.deleteFile"),
      cancelLabel: t("creatorEditor.lesson.keepFile"),
      danger: true,
      run: () => deleteAsset(asset),
    });
  }

  async function deleteAsset(asset: CourseAsset) {
    setError(null);
    setSuccess(null);
    setDeletingAssetId(asset.id);

    // Deleting the last video left the lesson declared as "upload" with no file
    // to play — the same hole the audit closed on the file-choice side, coming in
    // through the back door. The reader already falls back to the embed by itself
    // (resolveLessonVideoSource), but clearing here avoids saving a promise the
    // database cannot keep.
    const wasLastVideoAsset =
      isVideoAssetKind(asset.kind) && videoAssets.length === 1;

    try {
      await deleteCourseAsset(asset);

      if (wasLastVideoAsset && lesson.videoSource === "upload") {
        onUpdateLesson({ videoSource: null });
      }

      setSuccess("deleted");
      // The delete button goes away with the file: focus goes to the lesson title
      // (or the page itself, in the e-book), after the dialog closes.
      window.setTimeout(() => (document.getElementById("lesson-modal-title") ?? dialogRef.current)?.focus(), 0);
      void assetsReloadRef.current?.();
      onAssetsChanged?.();
    } catch {
      setError({ kind: "delete" });
    } finally {
      setDeletingAssetId(null);
    }
  }

  async function handleRenameAsset(asset: CourseAsset, title: string) {
    if (!isEditable) return;
    setError(null);
    setSuccess(null);
    setRenameNotice(null);
    try {
      await renameCourseAsset(asset.id, title);
      setRenameNotice({ assetId: asset.id, failed: false });
      void assetsReloadRef.current?.();
    } catch {
      setRenameNotice({ assetId: asset.id, failed: true });
    }
  }

  // Swaps the file with its neighbor and saves the whole list in the new order
  // (only the rows that changed go to the database).
  async function handleMoveMaterial(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (!isEditable || isSavingOrder || target < 0 || target >= materialAssets.length) return;
    const ordered = [...materialAssets];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setError(null);
    setSuccess(null);
    setIsSavingOrder(true);
    try {
      await saveCourseAssetOrder(ordered);
      setSuccess("ordered");
      await assetsReloadRef.current?.();
    } catch {
      setError({ kind: "save" });
    } finally {
      setIsSavingOrder(false);
    }
  }

  const isPage = variant === "page";

  // WAI-ARIA tabs: arrows, Home and End only move focus (wrapping around);
  // opening the tab is on Enter, Space or click. Switching tabs clears the chosen
  // file that is not yet uploaded (resetUploadState): passing through the bar
  // with the arrows must not erase the teacher's choice.
  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
    );
    const index = tabs.indexOf(event.currentTarget);
    const jump: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (index === -1 || !(event.key in jump)) return;
    event.preventDefault();
    tabs[(jump[event.key] + tabs.length) % tabs.length]?.focus();
  }

  // Without the bar (files only), the panel does not belong to any tab.
  function tabPanelProps(value: LessonModalTab) {
    return filesOnly
      ? {}
      : { role: "tabpanel", id: `lesson-modal-panel-${value}`, "aria-labelledby": `lesson-modal-tab-${value}` };
  }

  // Leaving through the breadcrumb goes through the same care as closing: an
  // upload in flight blocks it, the typed link goes first, and a rejected or
  // unconfirmed link keeps it on screen.
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
        aria-labelledby={filesOnly ? undefined : "lesson-modal-title"}
        className={isPage ? "lesson-modal lesson-modal--page" : "lesson-modal"}
        role={isPage ? undefined : "dialog"}
        onMouseDown={isPage ? undefined : (event) => event.stopPropagation()}
      >
        {filesOnly ? null : isPage && crumbs ? (
          <nav className="lesson-modal__header" aria-label={t("creatorEditor.builder.curriculum.breadcrumb")}>
            <ol className="lesson-modal__trail">
              <li>
                <Link
                  href={crumbs.courseHref}
                  scroll={false}
                  onClick={(event) => {
                    guardLeave(event);
                    // Only a plain click navigates in this tab (ctrl/cmd open
                    // another).
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
              {/* On screen the lesson name does not enter the breadcrumb: it
                  is the h3 right below (before, it appeared three times). For
                  the screen reader the breadcrumb still says where you are. */}
              <li aria-current="page" className="sr-only">{lesson.title || t("creatorEditor.lesson.untitled")}</li>
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

        {filesOnly ? null : (
        <div role="tablist" className="lesson-modal__tabs" aria-label={t("creatorEditor.lesson.setup")}>
          {lessonModalTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.value;
            // Fixed-width tag: the state word changed the tab's width while the
            // teacher worked ("Empty" > "Uploading" > "Uploaded") and the row
            // jumped. Now it is a 10 px mark that changes SHAPE (empty ring, half
            // full, full), not just color; the word stays in the title and for
            // the screen reader. Materials shows only the number.
            const descriptionDone = lesson.description.trim().length > 0 || Boolean(lesson.contentText?.trim());
            const dot =
              item.value === "video"
                ? { label: videoStatus, tone: videoBusy ? "busy" : assetStatus === "empty" ? "off" : "done" }
                : item.value === "description"
                  ? {
                      label: t(`creatorEditor.lesson.state.${descriptionDone ? "done" : "empty"}`),
                      tone: descriptionDone ? "done" : "off",
                    }
                  : item.value === "settings"
                    ? {
                        // Free preview is public: the teacher needs to see it
                        // without opening the tab.
                        label: t(`creatorEditor.lesson.state.${isFreePreview ? "preview" : "private"}`),
                        tone: isFreePreview ? "on" : "off",
                      }
                    : null;

            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                id={`lesson-modal-tab-${item.value}`}
                aria-selected={active}
                // Only the open tab has a panel on screen; Tab enters the bar
                // through it.
                aria-controls={active ? `lesson-modal-panel-${item.value}` : undefined}
                tabIndex={active ? 0 : -1}
                className={active ? "is-active" : ""}
                disabled={isUploading}
                onClick={() => handleTabChange(item.value)}
                onKeyDown={handleTabKeyDown}
              >
                <Icon aria-hidden="true" size={14} />
                {t(`creatorEditor.lesson.tabs.${item.value}`)}
                {item.value === "materials" ? (
                  <span className="lesson-modal__tab-count">{materialAssets.length}</span>
                ) : dot ? (
                  <span className="lesson-modal__tab-dot" data-tone={dot.tone} title={dot.label}>
                    <span className="sr-only">{dot.label}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        )}

        <div className="lesson-modal__body">
          {/* As abas travam durante o envio; sem esta frase pareciam quebradas. */}
          {isUploading && !filesOnly ? (
            <p className="lesson-modal__tabs-note">{t("creatorEditor.lesson.tabsLocked")}</p>
          ) : null}
          {filesOnly ? null : (
          <div className="lesson-modal__context">
            <h3 id="lesson-modal-title" tabIndex={-1}>{lesson.title || t("creatorEditor.lesson.untitled")}</h3>
            {/* On the page the breadcrumb already says course and module: the
                line repeated the module. */}
            {isPage && crumbs ? null : (
            <p className="lesson-modal__crumb">
              {t("creatorEditor.lesson.context")
                .replace("{moduleIndex}", () => String(moduleIndex + 1))
                .replace("{lessonIndex}", () => String(lessonIndex + 1))
                .replace("{moduleTitle}", () => module.title)}
            </p>
            )}
          </div>
          )}
          {tab === "video" ? (
            <div className="grid gap-5" {...tabPanelProps("video")}>

              <LessonVideoSourcePicker
                key={linkReplaced}
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
                // Without the lesson's files it is not possible to know whether
                // an upload exists: deleting the link now would save the source
                // as null with a saved upload.
                linkLockedHint={assetsLoaded
                  ? undefined
                  : loadErrorMessage || t("creatorEditor.lesson.linkLoading")}
                onModeChange={(next) => {
                  setVideoModeChoice(next);
                  uploadChosenBeforeLoadRef.current = next === "upload" && !assetsLoaded;
                  setLinkNotSaved(null);
                  resetUploadState("lesson_video");
                  // If the target media already exists, the switch applies to the
                  // learner right away: it saves only the source. Nothing is
                  // deleted. Without media, the switch stays only on screen until
                  // a link is accepted or an upload finishes. Before the files
                  // arrive, link mode is only the screen's plan B (it is not
                  // known whether an upload exists): saving "youtube" there took
                  // the learner off the upload in a back-and-forth with no
                  // effect.
                  if (next === "link" && assetsLoaded && trustedEmbed && lesson.videoSource !== "youtube") {
                    onUpdateLesson({ videoSource: "youtube" });
                  }
                  if (next === "upload" && primaryVideo && lesson.videoSource !== "upload") {
                    onUpdateLesson({ videoSource: "upload" });
                  }
                }}
                // Source and link in a single save, and only with an accepted
                // link. No course_assets is deleted here: the old upload stays in
                // the list.
                onLinkChange={(nextUrl, options) => {
                  // The user touched the link: the tab stays on link even if the source changes.
                  setVideoModeChoice("link");
                  if (!nextUrl) {
                    setLinkNotSaved(null);
                    // With a saved upload, the source goes back to it: the public
                    // course page only reads "upload" from the saved source
                    // (creator-course-detail), and the free preview video
                    // vanished from the sales page with the source at null.
                    const source = primaryVideo
                      ? "upload"
                      : lesson.videoSource === "youtube" ? null : lesson.videoSource;
                    onUpdateLesson({
                      externalUrl: null,
                      ...(source !== lesson.videoSource ? { videoSource: source } : {}),
                    });
                    return;
                  }
                  // The accepted link replaces the old link (Drive etc.): it asks
                  // for the same confirmation as the remove button, in the
                  // platform's dialog (it was window.confirm). The question is
                  // asynchronous and the picker expects an answer now: from here
                  // comes "did not save" (the field goes back to the saved value
                  // and Esc does not close the studio) and the save is left to
                  // the confirm, only once. If canceled: nothing changes, and
                  // only then the "not saved" notice is announced in the
                  // role="status" (before, it was read with the question open).
                  // Leaving the page (silent) cannot ask: it does not save.
                  if (oldLink) {
                    if (options?.silent) {
                      setLinkNotSaved((count) => (count ?? 0) + 1);
                      return false;
                    }
                    // With the question already open, it does not open another on
                    // top.
                    if (!asking) {
                      ask({
                        title: t("creatorEditor.lesson.removeOldLinkTitle"),
                        body: t("creatorEditor.lesson.removeOldLinkConfirm"),
                        confirmLabel: t("creatorEditor.lesson.removeOldLink"),
                        danger: true,
                        run: () => {
                          setLinkNotSaved(null);
                          onUpdateLesson({ videoSource: "youtube", externalUrl: nextUrl });
                          setLinkReplaced((count) => count + 1);
                          // The field that opened the question was remounted:
                          // with no target, focus goes to a button that stays.
                          window.setTimeout(() => {
                            if (document.activeElement === document.body) replaceButtonRef.current?.focus();
                          }, 0);
                        },
                        onCancel: () => setLinkNotSaved((count) => (count ?? 0) + 1),
                      });
                    }
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
                    isUploading={isUploading}
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
                    uploadingFileName={sharedUpload?.fileName}
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
                  className="grid gap-2 rounded-lg border border-[var(--color-line)] p-3 text-sm"
                >
                  <p className="font-semibold">{t("creatorEditor.lesson.oldLink")}</p>
                  <p className="break-all text-[var(--color-ink-soft)]">{oldLink}</p>
                  <p className="text-xs text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.oldLinkHelp")}</p>
                  <button
                    type="button"
                    className="button-outline justify-self-start px-3 py-2 text-xs"
                    // During the upload the swap button is disabled: focus would
                    // have nowhere to go and the notice would be lost.
                    disabled={!isEditable || isUploading}
                    onClick={() => ask({
                      title: t("creatorEditor.lesson.removeOldLinkTitle"),
                      body: t("creatorEditor.lesson.removeOldLinkConfirm"),
                      confirmLabel: t("creatorEditor.lesson.removeOldLink"),
                      danger: true,
                      run: () => {
                        onUpdateLesson({ externalUrl: null });
                        // This section goes away with the link: focus goes to a
                        // button that stays, and the notice is announced through the
                        // role="status". After the dialog closes (until then the
                        // page is inert).
                        setSuccess("oldLinkRemoved");
                        setLinkNotSaved(null);
                        window.setTimeout(() => replaceButtonRef.current?.focus(), 0);
                      },
                    })}
                  >
                    {t("creatorEditor.lesson.removeOldLink")}
                  </button>
                </section>
              ) : null}

              {/* With the upload form on screen, its role="status" gives the
                  notice; without it, this one. Never two at the same time.
                  The load error shows up here only in upload mode: in link
                  mode it already appears in the field itself. */}
              {videoMode === "upload" && isUploadPanelOpen ? null : (
                <p role="status" className="text-sm text-[var(--color-ink-soft)]">
                  {success === "oldLinkRemoved"
                    ? successMessage
                    : linkNotSaved
                      ? <span key={linkNotSaved}>{t("creatorEditor.lesson.linkNotSaved")}</span>
                      : videoMode === "upload" ? loadErrorMessage : ""}
                </p>
              )}
              {assetsRetry}

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

              {/* AI captions: only for video uploaded to Bunny (the audio
                  comes out of it and the published caption appears on it). */}
              {/* Collapsed by default: open, the caption (10 lines) and the
                  quiz (question by question) made the video tab three screens
                  tall and pushed "Done" far away. */}
              {isTeacherAiEnabled && isEditable && resolvedSource === "upload" && primaryVideo?.bunnyVideoId ? (
                <details className="rounded-md border fine-rule bg-[var(--color-surface-soft)] px-4 py-1">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[var(--color-ink)]">
                    {t("creatorEditor.lesson.ai.tools")}
                  </summary>
                  <div className="grid gap-6 pb-3 pt-2">
                    <LessonAiCaptions key={primaryVideo.id} courseId={course.id} lessonId={lesson.id} assetId={primaryVideo.id} />
                    <LessonAiQuiz key={`quiz-${primaryVideo.id}`} courseId={course.id} lessonId={lesson.id} assetId={primaryVideo.id} />
                  </div>
                </details>
              ) : null}

              <p className="lesson-modal__guidance">
                {t("creatorEditor.lesson.videoHelp")}
              </p>
            </div>
          ) : null}

          {tab === "description" ? (
            <div className="grid gap-4" {...tabPanelProps("description")}>
              <label className="lesson-modal-field">
                <span>{t("creatorEditor.lesson.title")}</span>
                <input
                  value={lesson.title}
                  onChange={(event) => onUpdateLesson({ title: event.target.value })}
                  disabled={!isEditable}
                />
              </label>
              {/* AI suggestion: reads the lesson caption; "Use" only fills in
                  the field. */}
              {isTeacherAiEnabled && isEditable && primaryVideo?.bunnyVideoId ? (
                <AiSuggest
                  courseId={course.id}
                  lessonId={lesson.id}
                  assetId={primaryVideo.id}
                  target="lesson"
                  currentDescription={lesson.contentText}
                  onUseTitle={(title) => onUpdateLesson({ title })}
                  onUseDescription={(contentText) => onUpdateLesson({ contentText })}
                />
              ) : null}
              {/* A single field, in plain text, in the PROTECTED field
                  (contentText: course_lesson_content, outside the public
                  JSON). Links become clickable in the members area (decision
                  of Sept 14). */}
              <label className="lesson-modal-field">
                <span>
                  {t("creatorEditor.lesson.description")}
                  {/* The free preview lesson has its text read by anyone on
                      the course page: "enrolled only" would mislead the
                      teacher. */}
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
              {/* The old public description is never deleted: it stays
                  collapsed and editable, and the learner keeps seeing it
                  where they already did. */}
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
                isUploading={isUploading}
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
              {assetsRetry}
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
            <div className="grid gap-5" {...tabPanelProps("materials")}>
              <div className="lesson-modal-note">
                <FileText aria-hidden="true" size={17} />
                <p>
                  {t("creatorEditor.lesson.materialsHelp")}
                </p>
              </div>
              <LessonUploadForm
                error={errorMessage}
                isEditable={isEditable}
                isUploading={isUploading}
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
              {assetsRetry}
              <LessonAssetList
                assets={materialAssets}
                emptyLabel={t("creatorEditor.lesson.noMaterials")}
                isEditable={isEditable}
                deletingAssetId={deletingAssetId}
                onDelete={handleDeleteAsset}
                onRename={(asset, title) => void handleRenameAsset(asset, title)}
                renameNotice={renameNotice}
                onRenameEdit={() => setRenameNotice(null)}
                onMove={(index, delta) => void handleMoveMaterial(index, delta)}
                isSavingOrder={isSavingOrder}
              />
            </div>
          ) : null}

          {tab === "settings" ? (
            <div className="grid gap-5" {...tabPanelProps("settings")}>
              {/* The whole row is the switch, as in Account: before, only the
                  44px target around the track responded and the text beside
                  it did not. The track is the house .settings-toggle;
                  role="switch" says on/off (aria-pressed said "pressed"). */}
              <button
                type="button"
                role="switch"
                aria-checked={isFreePreview}
                aria-label={t("creatorEditor.lesson.freePreviewLabel")}
                aria-describedby="lesson-modal-free-preview-help"
                onClick={onSetFreePreview}
                disabled={!isEditable}
                className="lesson-modal-setting"
              >
                <span>
                  <strong>{t("creatorEditor.lesson.freePreview")}</strong>
                  <span id="lesson-modal-free-preview-help" className="lesson-modal-setting__help">
                    {t("creatorEditor.lesson.freePreviewHelp")}
                  </span>
                </span>
                <span aria-hidden="true" className={`settings-toggle ${isFreePreview ? "settings-toggle--on" : ""}`}>
                  <span />
                </span>
              </button>
              {/* Only the "time_drip_custom" strategy reads the per-lesson
                  days (src/domain/drip-policy.ts); in the others the field
                  does nothing. */}
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
          {/* On the video tab the video sentence already closes the tab: they
              were two in a row. */}
          {filesOnly || tab === "video" ? null : (
          <p className="lesson-modal__guidance">
            {t("creatorEditor.lesson.contextHelp")}
          </p>
          )}
        </div>

        {filesOnly ? null : (
        <footer className="lesson-modal__footer">
          <p>
            <CheckCircle2 aria-hidden="true" size={14} />
            {t("creatorEditor.lesson.saveHelp")}
          </p>
          <button
            type="button"
            className="button-solid px-4 py-2.5 text-sm"
            onClick={requestClose}
            disabled={isUploading}
          >
            {/* "Done" was also the state of the Description tab; on the page
                the button says where it leads. */}
            <BusyLabel
              busy={isUploading}
              idle={t(isPage ? "creatorEditor.lesson.backToModule" : "creatorEditor.lesson.state.done")}
              busyText={t("creatorEditor.lesson.file.uploading")}
            />
          </button>
        </footer>
        )}
        {confirmDialog}
      </section>
  );

  return isPage ? content : (
    <div className="dialog-backdrop lesson-modal-overlay" role="presentation" onMouseDown={requestClose}>
      {content}
    </div>
  );
}

function LessonUploadForm({
  error,
  fileInputKey,
  isEditable,
  isUploading,
  onCancel,
  onFileChange,
  onSubmit,
  progressLabel,
  progressPercent,
  selectedFile,
  uploadingFileName,
  success,
  uploadKind,
  onKindChange,
}: {
  error: string;
  fileInputKey: number;
  isEditable: boolean;
  isUploading: boolean;
  /** Available only while bytes are in flight; null otherwise. */
  onCancel?: (() => void) | null;
  onFileChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  progressLabel: string;
  progressPercent?: number | null;
  selectedFile: File | null;
  /** Upload that continues from another mount of the lesson: only the name, without the file. */
  uploadingFileName?: string;
  success: string;
  uploadKind: CourseAssetKind;
  onKindChange?: (kind: CourseAssetKind) => void;
}) {
  const { t } = useTranslation();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [unpreviewableFile, setUnpreviewableFile] = useState<File | null>(null);
  const isVideo = isVideoAssetKind(uploadKind);
  // "Upload file" stays dimmed until there is a file: the line below says why.
  const needsFileId = useId();
  const needsFile = isEditable && !isUploading && !selectedFile;

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

  // Keyboard focus: the focused "Upload file" goes away when the upload starts,
  // and focus fell to the body (Cancel was a whole Tab loop away). It goes to
  // Cancel (or to the progress line, while Cancel does not exist) and, at the
  // end, goes back to the upload button or the file field. It only acts if focus
  // was in this card or lost.
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const wasUploadingRef = useRef(isUploading);
  const hasCancel = Boolean(onCancel);
  useEffect(() => {
    const wasUploading = wasUploadingRef.current;
    wasUploadingRef.current = isUploading;
    const form = formRef.current;
    const active = document.activeElement;
    if (active && active !== document.body && !form?.contains(active)) return;
    if (isUploading && (!wasUploading || active === statusRef.current)) {
      (cancelRef.current ?? statusRef.current)?.focus();
    } else if (!isUploading && wasUploading) {
      const submit = submitRef.current;
      (submit && !submit.disabled ? submit : form?.querySelector<HTMLInputElement>('input[type="file"]'))?.focus();
    }
  }, [isUploading, hasCancel]);

  // Compact card ("States" board): the 16:9 preview on one side, and on the other
  // the name, the progress, ONE bar and Cancel. The form was an unbounded grid
  // and the "Upload file" button took the page width (1,453 px at 1920 px).
  const fileLabel = selectedFile
    ? `${selectedFile.name} - ${formatCourseAssetSize(selectedFile.size)}`
    : isUploading ? uploadingFileName : undefined;
  return (
    <form
      ref={formRef}
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
      {isVideo && selectedFile?.type.startsWith("video/") ? (
        <video
          ref={localVideoRef}
          controls
          playsInline
          preload="metadata"
          aria-label={t("creatorEditor.lesson.file.localPreview")}
          className="lesson-modal-upload__video"
          hidden={unpreviewableFile === selectedFile}
          onError={() => setUnpreviewableFile(selectedFile)}
        />
      ) : null}
      <div className="lesson-modal-upload__body">
      {fileLabel ? <p className="lesson-modal-upload__file">{fileLabel}</p> : null}
      {error ? <p role="alert" className="lesson-modal-upload__error">{error}</p> : null}
      <p ref={statusRef} tabIndex={-1} role="status" className={success ? "lesson-modal-upload__success" : "text-sm text-[var(--color-ink-soft)]"}>
        {isUploading ? progressLabel || t("creatorEditor.lesson.file.uploading")
          : success || (selectedFile ? t("creatorEditor.lesson.file.selectedHelp") : "")}
      </p>
      {isUploading ? (
        <>
          <progress className="upload-progress" max={100} value={progressPercent ?? undefined} aria-label={t("creatorEditor.lesson.file.uploading")} />
          {onCancel ? (
            <button ref={cancelRef} type="button" onClick={onCancel} className="button-outline min-h-11 px-3 text-sm">
              {t("creatorEditor.lesson.file.cancel")}
            </button>
          ) : null}
        </>
      ) : null}
      {isVideo && selectedFile && unpreviewableFile === selectedFile ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.file.previewUnavailable")}</p>
      ) : null}
      {/* During the upload these controls were already disabled and only
          repeated the progress ("Uploading..."): they leave the view, but
          stay mounted so the file field is not recreated in the middle of the
          upload. */}
      <div className="lesson-modal-upload__actions" hidden={isUploading}>
      <button
        ref={submitRef}
        type="submit"
        autoFocus={isVideo && Boolean(selectedFile)}
        disabled={!isEditable || isUploading || !selectedFile}
        aria-describedby={needsFile ? needsFileId : undefined}
        className="button-solid min-h-11 px-4 py-2.5 text-sm"
      >
        {t(`creatorEditor.lesson.file.${isUploading ? "uploading" : "upload"}`)}
      </button>
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
      </div>
      {needsFile ? (
        <p id={needsFileId} className="text-xs text-[var(--color-ink-soft)]">
          {t("creatorEditor.lesson.file.needsFile")}
        </p>
      ) : null}
      {onKindChange ? (
        <label className="lesson-modal-field" hidden={isUploading}>
          <span>{t("creatorEditor.lesson.file.videoType")}</span>
          <select value={uploadKind} disabled={!isEditable || isUploading}
            onChange={(event) => onKindChange(event.target.value as "lesson_video" | "live_recording")}>
            <option value="lesson_video">{getCourseAssetKindLabel("lesson_video", t)}</option>
            <option value="live_recording">{getCourseAssetKindLabel("live_recording", t)}</option>
          </select>
        </label>
      ) : null}
      </div>
    </form>
  );
}

function LessonAssetList({
  assets,
  emptyLabel,
  isEditable,
  deletingAssetId,
  onDelete,
  onRename,
  renameNotice = null,
  onRenameEdit,
  onMove,
  isSavingOrder = false,
}: {
  assets: CourseAsset[];
  emptyLabel: string;
  isEditable: boolean;
  deletingAssetId: string | null;
  onDelete: (asset: CourseAsset) => void;
  /** Materials: the name the learner sees, saved when leaving the field. */
  onRename?: (asset: CourseAsset, title: string) => void;
  /** The result of the last saved name, shown below its field. */
  renameNotice?: { assetId: string; failed: boolean } | null;
  /** Typing again: the earlier "saved" is no longer true. */
  onRenameEdit?: () => void;
  /** Materials: moves the file up (-1) or down (+1) in the list. */
  onMove?: (index: number, delta: -1 | 1) => void;
  isSavingOrder?: boolean;
}) {
  const { t } = useTranslation();
  if (assets.length === 0) {
    return <p className="lesson-modal-empty">{emptyLabel}</p>;
  }

  return (
    <div className="lesson-modal-assets">
      {assets.map((asset, index) => {
        const thumbnailUrl = asset.kind === "lesson_thumbnail"
          ? getSafeMediaUrl(asset.downloadUrl)
          : null;
        const title = getCourseAssetTitle(asset);
        return (
        <article key={asset.id}>
          <div className="min-w-0 flex-1">
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnailUrl} alt={t("creatorEditor.lesson.thumbnailAlt").replace("{fileName}", () => asset.fileName)} className="mb-2 max-h-32 max-w-full rounded-lg object-contain" />
            ) : null}
            {onRename ? (
              <label className="grid gap-1">
                <span className="lesson-modal-assets__meta">{t("creatorEditor.lesson.files.titleLabel")}</span>
                <input
                  // The key changes when the saved name changes: after saving,
                  // the field shows what is in the database (trimmed).
                  key={title}
                  defaultValue={title}
                  maxLength={courseAssetTitleMaxLength}
                  disabled={!isEditable}
                  onChange={() => {
                    if (renameNotice?.assetId === asset.id) onRenameEdit?.();
                  }}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next !== title) onRename(asset, next);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="min-h-11 w-full rounded-md border border-[var(--color-line)] bg-white px-3 text-sm font-semibold text-[var(--color-ink)]"
                />
              </label>
            ) : (
              <strong>{title}</strong>
            )}
            {/* Outside the label (otherwise it would enter the field's name)
                and in a <p>: the detail line of this list is uppercase and
                gray. */}
            {renameNotice?.assetId === asset.id ? (
              <p
                role={renameNotice.failed ? "alert" : "status"}
                className={`mt-1 text-xs font-semibold ${renameNotice.failed ? "text-[var(--color-danger-fg)]" : "text-[var(--color-success-fg)]"}`}
              >
                {renameNotice.failed ? getLessonErrorMessage({ kind: "save" }, t) : t("creatorEditor.lesson.success.renamed")}
              </p>
            ) : null}
            <span className="lesson-modal-assets__meta">
              {getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}
            </span>
            {onRename && title !== asset.fileName ? (
              <span className="lesson-modal-assets__meta">{t("creatorEditor.lesson.files.originalName").replace("{fileName}", () => asset.fileName)}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {onMove && isEditable ? (
              // aria-disabled, not disabled: the button turned off during the
              // save sent keyboard focus to the top of the page on every move. A
              // click at the wrong time (saving, or at the end of the list) is
              // ignored by whoever receives onMove.
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onMove(index, -1)}
                  aria-disabled={index === 0 || isSavingOrder}
                  aria-label={t("creatorEditor.lesson.files.moveUp").replace("{title}", () => title)}
                  className="button-outline min-h-11 min-w-11 px-2"
                >
                  <ArrowUp aria-hidden="true" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(index, 1)}
                  aria-disabled={index === assets.length - 1 || isSavingOrder}
                  aria-label={t("creatorEditor.lesson.files.moveDown").replace("{title}", () => title)}
                  className="button-outline min-h-11 min-w-11 px-2"
                >
                  <ArrowDown aria-hidden="true" size={16} />
                </button>
              </div>
            ) : null}
            {/* "Preview" only exists for video (the sample lesson); material
                is always enrolled-only, marked or not in the past. */}
            <small>{asset.isPreview && isVideoAssetKind(asset.kind) ? t("creatorEditor.lesson.state.preview") : t("creatorEditor.lesson.enrolledOnly")}</small>
            {isEditable ? (
              <button
                type="button"
                onClick={() => onDelete(asset)}
                disabled={deletingAssetId === asset.id}
                className="button-danger px-3.5 py-2 text-xs"
              >
                {/* The uppercase gray of the list lives in
                    .lesson-modal-assets__meta (globals.css), not in every
                    span here: the two faces stay in the same cell. */}
                <BusyLabel
                  busy={deletingAssetId === asset.id}
                  idle={t("creatorEditor.lesson.delete")}
                  busyText={t("creatorEditor.lesson.deleting")}
                />
              </button>
            ) : null}
          </div>
        </article>
        );
      })}
    </div>
  );
}
