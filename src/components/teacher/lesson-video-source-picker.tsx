"use client";

import { useId, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { HelpCircle, Link2, ShieldAlert, UploadCloud } from "lucide-react";

import { Tooltip } from "@/components/shared/tooltip";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";

export type LessonVideoMode = "upload" | "link";

// The modal calls flushLink before closing on Esc or an outside click: on those
// paths the field is unmounted with no blur reaching React 19, and the typed
// link was lost. "rejected" and "declined" keep the modal open, with the
// error or the notice on screen, instead of silently losing the link.
export type LinkCommitResult = "saved" | "unchanged" | "rejected" | "declined";
// `silent`: flush on leaving the page. It never opens a confirmation; whatever would ask
// for one ("declined") is simply not saved.
export type LessonVideoSourcePickerHandle = {
  flushLink: (options?: { silent?: boolean }) => LinkCommitResult;
};

// An input type="url" strips line breaks and the spaces at the ends of the value:
// the value expected from a paste is compared already cleaned.
function cleanUrlInput(value: string) {
  return value.replace(/[\r\n]/g, "").trim();
}

// With no scheme ("youtube.com/watch?v=..."), it assumes https:// before validating; the
// saved link already comes out normalized.
function normalizeLink(value: string) {
  const trimmed = value.trim();
  return !trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// One lesson, one video (decision of Sep 14): the studio shows EITHER the upload OR the
// YouTube/Vimeo link, never both. Switching is an explicit action ("Replace with
// link" / "Replace with upload") and deletes nothing: the old upload stays
// listed in the modal, with its own delete button.
// ponytail: the ref comes out of `props` in the destructuring; if it stayed, the
// react-hooks/refs rule treated every `props.x` as a ref read during render.
export function LessonVideoSourcePicker({ replaceButtonRef, linkHandleRef, ...props }: {
  mode: LessonVideoMode;
  disabled?: boolean;
  accept: string;
  externalUrl: string;
  embedStatus: string;
  onModeChange: (next: LessonVideoMode) => void;
  onSelectFile: (file: File) => void;
  // Only receives an accepted link (YouTube/Vimeo), or null when the teacher deletes the
  // accepted link the field was showing. A rejected link never leaves here. Returns
  // false when the modal did not save (the teacher did not confirm): the field goes back
  // to what is saved.
  onLinkChange: (next: string | null, options?: { silent?: boolean }) => boolean | void;
  uploadPanel?: ReactNode;
  // Stable focus target for the modal (e.g. after removing the old link).
  replaceButtonRef?: Ref<HTMLButtonElement>;
  linkHandleRef?: Ref<LessonVideoSourcePickerHandle>;
  // With text, the link field becomes read-only and shows this notice (e.g. the lesson's
  // files have not arrived yet).
  linkLockedHint?: string;
}) {
  const { t } = useTranslation();
  const urlInputId = useId();
  const errorId = useId();
  const hintId = useId();
  const noteId = useId();
  const [isDragActive, setIsDragActive] = useState(false);
  const savedIsEmbed = Boolean(getTrustedLessonEmbed(props.externalUrl));
  // Local draft: what the teacher types only becomes data when it is an accepted link.
  // An old link that is not a video (Drive etc.) does not go into the field: the modal
  // shows it separately, read-only.
  const [draft, setDraft] = useState(() => (savedIsEmbed ? props.externalUrl : ""));
  const [rejected, setRejected] = useState(false);
  // Value the last paste should produce; the next onChange consumes it.
  const pastedValueRef = useRef<string | null>(null);
  const locked = Boolean(props.linkLockedHint);

  function selectFile(file: File) {
    // Choosing a file does NOT declare the lesson's source. It used to, and that
    // wiped the lesson for someone who had already paid: `videoSource` is persisted by the
    // 1.8s autosave and is the field the learner reads to choose the player. With the
    // source on "upload" and no file uploaded — because the teacher chose the wrong
    // file, or gave up on hitting the limit —, the learner started seeing
    // "Media not attached yet", while the YouTube link stayed saved and
    // valid, just never consulted again.
    //
    // Whoever declares the source is the upload's SUCCESS path, in
    // lesson-content-modal — when there is, in fact, a file to play.
    props.onSelectFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);

    if (props.disabled) {
      return;
    }

    const file = Array.from(event.dataTransfer.files).find((candidate) =>
      candidate.type.startsWith("video/"),
    );

    if (file) {
      selectFile(file);
    }
  }

  // Saves only on leaving the field, on Enter or on paste: saving on every keystroke
  // saved truncated video ids and reported an error in the middle of typing.
  function commitLink(value: string, silent = false): LinkCommitResult {
    if (locked) {
      return "unchanged";
    }

    const url = normalizeLink(value);

    if (url && !getTrustedLessonEmbed(url)) {
      setRejected(true);
      return "rejected";
    }

    setRejected(false);
    // An empty field removes the accepted link it was showing. An old link never
    // shows up here (the base is ""), so it is never deleted by this path.
    const saved = savedIsEmbed ? props.externalUrl : "";
    if (url === saved) {
      setDraft(url);
      return "unchanged";
    }
    const kept = (silent
      ? props.onLinkChange(url || null, { silent: true })
      : props.onLinkChange(url || null)) !== false;
    // Did not save: the field goes back to the saved value, otherwise every following blur (X, tab,
    // "Replace with upload") asked again and swallowed the click. On the silent flush
    // nobody was asked: what was typed stays in the field.
    if (kept || !silent) {
      setDraft(kept ? url : saved);
    }
    return kept ? "saved" : "declined";
  }

  useImperativeHandle(linkHandleRef, () => ({
    flushLink: (options) => (props.mode === "link" ? commitLink(draft, options?.silent) : "unchanged"),
  }));

  return (
    <div className="lesson-video-source-picker">
      <p className="lesson-video-source-picker__heading">{t("creatorEditor.videoSource.heading")}</p>
      <div className="lesson-video-source-picker__options">
        {props.mode === "upload" ? (
          props.uploadPanel ?? (
            <label
              className={`lesson-video-source-picker__dropzone${
                isDragActive ? " is-drag-active" : ""
              }`}
              data-disabled={props.disabled ? "true" : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                if (!props.disabled) {
                  setIsDragActive(true);
                }
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept={props.accept}
                disabled={props.disabled}
                aria-label={t("creatorEditor.videoSource.fileInput")}
                className="lesson-modal-upload__input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    selectFile(file);
                  }
                  // Allow re-picking the same file after a failed upload.
                  event.target.value = "";
                }}
              />
              <UploadCloud aria-hidden="true" size={22} />
              <span>
                <strong>{t("creatorEditor.videoSource.device")}</strong>
                <small>
                  {isDragActive
                    ? t("creatorEditor.videoSource.dropActive")
                    : t("creatorEditor.videoSource.dropIdle")}
                </small>
                <small>{t("creatorEditor.videoSource.browseHelp")}</small>
              </span>
              <span className="button-solid">
                {t("creatorEditor.videoSource.chooseVideo")}
              </span>
            </label>
          )
        ) : (
          <div className="lesson-video-source-picker__url is-active">
            <span className="lesson-video-source-picker__url-label">
              <Link2 aria-hidden="true" size={15} className="shrink-0" />
              <label htmlFor={urlInputId} className="min-w-0 font-bold">{t("creatorEditor.videoSource.url")}</label>
              <Tooltip content={t("creatorEditor.videoSource.help")}>
                <button
                  type="button"
                  aria-label={t("creatorEditor.videoSource.helpLabel")}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <HelpCircle aria-hidden="true" size={13} />
                </button>
              </Tooltip>
            </span>
            <input
              id={urlInputId}
              type="url"
              value={draft}
              disabled={props.disabled}
              readOnly={locked}
              aria-invalid={rejected || undefined}
              aria-describedby={[rejected ? errorId : locked ? hintId : null, noteId].filter(Boolean).join(" ")}
              placeholder="https://www.youtube.com/watch?v=..."
              // The browser pastes at the cursor or the selection (and Ctrl+Z undoes it);
              // here we only note the value the paste should produce, and the next
              // onChange saves it if the value matches. Pasting the same text
              // (or nothing) does not fire onChange, and the note does not match the
              // next key, so no keystroke becomes a paste.
              onPaste={(event) => {
                const text = event.clipboardData?.getData("text") ?? "";
                const input = event.currentTarget;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                pastedValueRef.current = text
                  ? input.value.slice(0, start) + text + input.value.slice(end)
                  : null;
              }}
              onChange={(event) => {
                const pasted = pastedValueRef.current;
                pastedValueRef.current = null;
                if (locked) {
                  return;
                }
                setDraft(event.target.value);
                setRejected(false);
                if (pasted !== null && cleanUrlInput(pasted) === cleanUrlInput(event.target.value)) {
                  commitLink(event.target.value);
                }
              }}
              onBlur={(event) => commitLink(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLink(event.currentTarget.value);
                }
              }}
            />
            {rejected ? (
              <small id={errorId} role="alert" className="font-semibold text-[var(--color-danger-fg)]">
                {t("creatorEditor.videoSource.rejected")}
              </small>
            ) : locked ? (
              // Loading, or the load error: announced and tied to the field.
              <small id={hintId} role="status">{props.linkLockedHint}</small>
            ) : (
              <small>{props.embedStatus}</small>
            )}
            {/* The protection trade-off belongs next to the link: an embed is
                still a public link on YouTube or Vimeo; an Upload plays
                through SkillsetMind's access check (which still lets anyone
                watch the course's free-preview lesson). Always part of the
                field's description, next to the error or hint. */}
            <small id={noteId} className="mt-1 flex items-start gap-1.5 text-[var(--color-ink-muted)]">
              <ShieldAlert aria-hidden="true" size={13} className="mt-px shrink-0" />
              <span>
                {t("creatorEditor.videoSource.protectionNote")}
              </span>
            </small>
          </div>
        )}
      </div>
      <button
        ref={replaceButtonRef}
        type="button"
        className="button-outline justify-self-start px-3 py-2 text-xs"
        disabled={props.disabled}
        onClick={() => props.onModeChange(props.mode === "upload" ? "link" : "upload")}
      >
        {props.mode === "upload"
          ? t("creatorEditor.videoSource.replaceWithLink")
          : t("creatorEditor.videoSource.replaceWithUpload")}
      </button>
    </div>
  );
}
