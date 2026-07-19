"use client";

import { useState, type DragEvent } from "react";
import { Link2, UploadCloud } from "lucide-react";

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
        </label>
      </div>
    </div>
  );
}
