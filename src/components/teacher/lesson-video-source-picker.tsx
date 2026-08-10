"use client";

import { useState, type DragEvent } from "react";
import { HelpCircle, Link2, ShieldAlert, UploadCloud } from "lucide-react";

import { Tooltip } from "@/components/shared/tooltip";

type LessonVideoSource = "youtube" | "upload";

// Both video sources are first-class and always visible: a drag&drop dropzone
// for uploads next to the YouTube/Vimeo URL field (stacked on mobile). There is
// no "choose a source first" step — interacting with either side selects it.
export function LessonVideoSourcePicker(props: {
  value: LessonVideoSource | null;
  disabled?: boolean;
  accept: string;
  externalUrl: string;
  embedStatus: string;
  onChange: (next: LessonVideoSource) => void;
  onSelectFile: (file: File) => void;
  onExternalUrlChange: (next: string) => void;
}) {
  const [isDragActive, setIsDragActive] = useState(false);

  function selectFile(file: File) {
    if (props.value !== "upload") {
      props.onChange("upload");
    }
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

  return (
    <div className="lesson-video-source-picker">
      <p className="lesson-video-source-picker__heading">Add the lesson video</p>
      <div className="lesson-video-source-picker__options">
        <label
          className={`lesson-video-source-picker__dropzone${
            isDragActive ? " is-drag-active" : ""
          }${props.value === "upload" ? " is-active" : ""}`}
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
            aria-label="Upload a lesson video"
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
            <strong>
              {isDragActive
                ? "Drop the video to select it"
                : "Drag & drop your video here"}
            </strong>
            <small>or click to browse — MP4, MOV, WebM and other video files.</small>
          </span>
        </label>

        <label
          className={`lesson-video-source-picker__url${
            props.value === "youtube" ? " is-active" : ""
          }`}
        >
          <span className="lesson-video-source-picker__url-label">
            <Link2 aria-hidden="true" size={15} />
            <strong>YouTube or Vimeo URL</strong>
            <Tooltip content="Paste the video's page link — e.g. https://www.youtube.com/watch?v=… or a Vimeo URL. We turn it into a privacy-friendly embed that plays inside the classroom, stamped with the student's identity. It stays a link on YouTube or Vimeo, though: anyone who reaches that link can watch it outside your course. Upload instead and playback is signed per student.">
              <button
                type="button"
                aria-label="How the YouTube or Vimeo URL field works"
                className="inline-flex items-center text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                <HelpCircle aria-hidden="true" size={13} />
              </button>
            </Tooltip>
          </span>
          <input
            type="url"
            value={props.externalUrl}
            disabled={props.disabled}
            placeholder="https://www.youtube.com/watch?v=..."
            onChange={(event) => {
              if (props.value !== "youtube") {
                props.onChange("youtube");
              }
              props.onExternalUrlChange(event.target.value);
            }}
          />
          <small>{props.embedStatus}</small>
          {/* The teacher decides between the two sources right here, so the
              protection trade-off belongs here too — not buried in a help page.
              An embed is still a public link on YouTube or Vimeo; only Upload
              gets per-student signed playback. */}
          <small className="mt-1 flex items-start gap-1.5 text-[var(--color-ink-muted)]">
            <ShieldAlert aria-hidden="true" size={13} className="mt-px shrink-0" />
            <span>
              An embedded video stays a link on YouTube or Vimeo — anyone with
              that link can watch it outside your course. Upload the file
              instead and each student gets their own signed playback.
            </span>
          </small>
        </label>
      </div>
    </div>
  );
}
