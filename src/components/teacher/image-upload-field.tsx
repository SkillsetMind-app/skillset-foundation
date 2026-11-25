"use client";

import { Image as ImageIcon, UploadCloud } from "lucide-react";
import { useId, type InputHTMLAttributes, type Ref } from "react";

import { InlineAlert } from "@/components/ui";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";
import { cn } from "@/lib/cn";

import { UploadProgressNote } from "./upload-progress-note";

type FileInputAttrs = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  ref?: Ref<HTMLInputElement>;
  /** Changing the value remounts the file input and clears the previous choice. */
  resetKey?: number;
};

export type ImageUploadFieldProps = {
  /** Field name: the visible title and the name of the region. */
  title: string;
  /** File rules, right below the title; they also describe the button. */
  help?: string;
  preview: {
    src: string | null | undefined;
    alt: string;
    /** 2:3 at 128px (module cover); without this, 16:9 up to 200px. */
    portrait?: boolean;
    /** Another frame (ratio and width) in place of 16:9 up to 200px:
     *  the storefront uses 1:1 for the logo and 16:7 for the cover, as it already drew.
     *  Ignored when `portrait` is on (the 2:3 frame applies). */
    frame?: string;
    /** The whole image, with margin, instead of covering the frame (the logo). */
    contain?: boolean;
    /** Text of the empty box. */
    emptyLabel?: string;
  };
  /** Fixed button label: it does not become "Uploading..."; the progress is the note. */
  triggerLabel: string;
  /** The file input as each screen already had it (accept, onChange, disabled...). */
  input: FileInputAttrs;
  /** "Remove" in red text, only with an image and out of view during an upload. */
  remove?: { label: string; onClick: () => void };
  progress: UploadCourseAssetProgress | null;
  error?: string;
  /** Help line when nothing is uploading and there is no error. */
  note?: string;
  className?: string;
};

/**
 * The single shell of the image field (B-05): preview, choose/replace button,
 * upload note, error notice and the "Remove". There were four hand-made designs (the
 * two builder covers, the sales page image and the members area
 * cover). Presentation only: each screen keeps its own upload, limits,
 * compression and what it does with the result.
 */
export function ImageUploadField({
  title,
  help,
  preview,
  triggerLabel,
  input,
  remove,
  progress,
  error,
  note,
  className,
}: ImageUploadFieldProps) {
  const helpId = useId();
  const { resetKey, ...inputAttrs } = input;
  const disabled = Boolean(inputAttrs.disabled);
  const { portrait = false } = preview;

  return (
    <section aria-label={title} className={cn("grid min-w-0 content-start gap-3", className)}>
      <div>
        <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
        {help ? (
          <p id={helpId} className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-ink-soft)]">
            {help}
          </p>
        ) : null}
      </div>

      <div className={portrait ? "grid min-w-0 gap-3" : "grid min-w-0 gap-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start"}>
        <div
          className={`relative overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] ${
            portrait ? "aspect-[2/3] w-32" : (preview.frame ?? "aspect-video w-full max-w-[200px]")
          }`}
        >
          {preview.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- the image comes from Storage or a pasted link
            <img src={preview.src} alt={preview.alt} className={preview.contain ? "h-full w-full object-contain p-2" : "h-full w-full object-cover"} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-soft)]">
              <ImageIcon size={22} aria-hidden />
              {preview.emptyLabel ? (
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{preview.emptyLabel}</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:border-[var(--color-primary-light)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-ring)] ${
                disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
              }`}
            >
              <UploadCloud size={16} aria-hidden />
              {triggerLabel}
              <input
                key={resetKey}
                {...inputAttrs}
                type="file"
                aria-describedby={help ? helpId : undefined}
                className="sr-only"
              />
            </label>
            {remove && preview.src && !progress ? (
              <button
                type="button"
                onClick={remove.onClick}
                className="min-h-11 w-fit text-xs font-semibold text-[var(--color-danger-fg)] underline-offset-2 hover:underline"
              >
                {remove.label}
              </button>
            ) : null}
          </div>

          {/* One place for the state: progress, or error, or the help. */}
          {progress ? (
            <UploadProgressNote progress={progress} />
          ) : error ? (
            <InlineAlert tone="error" className="px-3 py-2 text-xs">
              {error}
            </InlineAlert>
          ) : note ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{note}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
