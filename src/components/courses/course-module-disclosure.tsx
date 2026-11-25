"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

// A module of the sales page curriculum, which opens and closes. A button with
// aria-expanded INSIDE the heading (the accordion pattern), and not <details>:
// Safari with VoiceOver flattens the <summary> content, and people who navigate by
// headings lost the modules. The design is the same as before: name, lessons and
// duration on the line, an arrow that rotates.
export function CourseModuleDisclosure({
  title,
  meta,
  defaultOpen = false,
  headingLevel = 2,
  children,
}: {
  title: string;
  /** "3 lessons · 25 min": what the module has, visible even when closed. */
  meta: string;
  defaultOpen?: boolean;
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div className="rounded-lg border fine-rule bg-[var(--color-surface-soft)]">
      <Heading>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-4 py-3 text-left"
        >
          <span className="text-base font-bold text-[var(--color-ink)]">{title}</span>
          {/* The space does not show in the grid, but it separates name and data in the name
              read by the screen reader. */}
          {" "}
          <span className="mt-0.5 text-xs font-normal text-[var(--color-ink-soft)]">{meta}</span>
          <ChevronDown
            aria-hidden="true"
            size={18}
            strokeWidth={2.2}
            className={`col-start-2 row-span-2 row-start-1 text-[var(--color-primary)] motion-safe:transition-transform motion-safe:duration-[180ms]${open ? " rotate-180" : ""}`}
          />
        </button>
      </Heading>
      {/* When closed, the lessons leave the screen and the screen reader, as in a <details>. */}
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
