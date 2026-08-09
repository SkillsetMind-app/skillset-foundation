"use client";

import { CheckCircle2, LockKeyhole, PlayCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule } from "@/domain/learning";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";

type LessonListOverlayProps = {
  modules: CourseModule[];
  selectedLessonId: string | null;
  completedLessonIds: string[];
  unlockStateById: Map<string, LessonUnlockState>;
  onSelect: (lessonId: string) => void;
  onClose: () => void;
};

// The sidebar strip only lists the ACTIVE module, so the full curriculum was
// unreachable without hunting through the module selector. This is the whole
// course in one overlay with its own search — the pattern every member area
// the student already uses (Hotmart, Eduzz) ships.
// ponytail: the parent mounts this only while open, so closing throws the
// search away for free — no reset effect.
export function LessonListOverlay({
  modules,
  selectedLessonId,
  completedLessonIds,
  unlockStateById,
  onSelect,
  onClose,
}: LessonListOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  useModalFocus(dialogRef, true);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  // Lesson numbers stay absolute across the whole course, so filtering never
  // renumbers what the student is looking at.
  const groups = useMemo(() => {
    let position = 0;

    return modules.map((module) => {
      const lessons = module.lessons.map((lesson) => {
        position += 1;
        return { lesson, position };
      });

      return {
        module,
        lessons: normalizedQuery
          ? lessons.filter(({ lesson }) =>
              lesson.title.toLowerCase().includes(normalizedQuery),
            )
          : lessons,
      };
    });
  }, [modules, normalizedQuery]);

  const matchCount = groups.reduce(
    (total, group) => total + group.lessons.length,
    0,
  );

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex items-stretch justify-center outline-none sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lesson-list-overlay-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(15,39,68,0.62)] backdrop-blur-[2px]"
        aria-label="Close lesson list"
        onClick={onClose}
      />
      <div className="relative z-[75] flex w-full max-w-3xl flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(15,39,68,0.32)] sm:max-h-[86vh] sm:rounded-[8px]">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Curriculum
            </p>
            <h2
              id="lesson-list-overlay-title"
              className="display-title mt-1 text-xl text-[var(--color-primary)] sm:text-2xl"
            >
              All lessons
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-[8px] text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
            aria-label="Close lesson list"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        <div className="border-b border-[var(--color-line)] px-5 py-3 sm:px-6">
          <label className="flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
            <Search
              aria-hidden="true"
              className="text-[var(--color-ink-soft)]"
              size={16}
              strokeWidth={1.8}
            />
            <span className="sr-only">Search lessons</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search lessons"
              className="w-full bg-transparent text-sm text-[var(--color-primary)] outline-none placeholder:text-[var(--color-ink-soft)]"
            />
          </label>
          <p aria-live="polite" className="mt-2 text-xs text-[var(--color-ink-soft)]">
            {normalizedQuery
              ? `${matchCount} lesson${matchCount === 1 ? "" : "s"} match "${query.trim()}"`
              : `${matchCount} lesson${matchCount === 1 ? "" : "s"} in this course`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-soft)] px-4 py-4 sm:px-6">
          {matchCount === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-ink-soft)]">
              No lesson matches that search.
            </p>
          ) : (
            <ol className="grid gap-5">
              {groups.map((group, moduleIndex) =>
                group.lessons.length === 0 ? null : (
                  <li key={group.module.id}>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                      Module {moduleIndex + 1} &middot; {group.module.title}
                    </p>
                    <ul className="mt-2 grid gap-2">
                      {group.lessons.map(({ lesson, position }) => {
                        const isCompleted = completedLessonIds.includes(lesson.id);
                        const isSelected = selectedLessonId === lesson.id;
                        const unlocked =
                          unlockStateById.get(lesson.id)?.unlocked ?? true;

                        return (
                          <li key={lesson.id}>
                            <button
                              type="button"
                              onClick={() => {
                                onSelect(lesson.id);
                                onClose();
                              }}
                              aria-current={isSelected ? "true" : undefined}
                              className={`flex w-full items-center gap-3 rounded-[10px] border bg-white px-3 py-3 text-left transition-colors hover:border-[var(--color-primary-light)] ${
                                isSelected
                                  ? "border-[var(--color-primary)]"
                                  : "border-[var(--color-line)]"
                              }`}
                            >
                              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-surface-strong)] text-xs font-bold text-[var(--color-primary)]">
                                {isCompleted ? (
                                  <CheckCircle2 aria-hidden size={15} />
                                ) : isSelected ? (
                                  <PlayCircle aria-hidden size={15} />
                                ) : unlocked ? (
                                  position
                                ) : (
                                  <LockKeyhole aria-hidden size={14} />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-[var(--color-primary)]">
                                  {lesson.title}
                                </span>
                                <span className="mt-0.5 block text-xs text-[var(--color-ink-soft)]">
                                  {lesson.duration}
                                  {isCompleted ? " · Completed" : ""}
                                  {!unlocked ? " · Locked" : ""}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
