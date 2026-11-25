"use client";

import { ChevronDown, LockKeyhole, PlayCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatUnlockDate, type LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule } from "@/domain/learning";
import { LessonThumbnail } from "@/components/learn/lesson-thumbnail";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { DrawnCheck } from "@/components/ui/drawn-check";

type CoursePlaylistProps = {
  thumbnailUrlByLessonId?: ReadonlyMap<string, string>;
  modules: CourseModule[];
  selectedLessonId: string | null;
  completedLessonIds: string[];
  unlockStateById: Map<string, LessonUnlockState>;
  onSelect: (lessonId: string) => void;
  /** Only the completed lesson's check is clickable — to undo. Completing lives
   *  in one place only: the button under the video (and the auto-advance). */
  onUncomplete?: (lessonId: string) => void;
  /** Lessons completed with the classroom open: their check gets drawn. */
  justCompletedIds?: ReadonlySet<string>;
};

// The playlist beside the video.
//
// POR QUE ISTO EXISTE
//
// The lesson list existed three times in the classroom — the "Continue" card, a module
// rail + card grid, and the "All lessons" dialog — and none was
// visible while the video played. Beside the video there was a card of numbers
// ("Lesson 3/12 · Files 2"). What the learner wants there is the list: modules in an
// accordion, current lesson highlighted, check and lock per lesson, search at the top.
export function CoursePlaylist({
  thumbnailUrlByLessonId,
  modules,
  selectedLessonId,
  completedLessonIds,
  unlockStateById,
  onSelect,
  onUncomplete,
  justCompletedIds,
}: CoursePlaylistProps) {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState("");
  // The current lesson was highlighted but the list did not scroll to it: switching lessons
  // (or the auto-advance) left the highlight outside the visible area of the
  // playlist and the person lost their place. `block: "nearest"` scrolls the minimum — and
  // does not move anything if the row is already in view.
  const currentLessonRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    currentLessonRef.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [selectedLessonId]);
  // Modules closed by the person. The current lesson's module opens on its own; the
  // others start closed, and search opens everything that has a result.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const normalizedQuery = query.trim().toLowerCase();
  const activeModuleId =
    modules.find((module) =>
      module.lessons.some((lesson) => lesson.id === selectedLessonId),
    )?.id ?? modules[0]?.id ?? null;

  // Absolute numbering across the whole course: filtering never renumbers.
  const groups = useMemo(() => {
    let position = 0;
    return modules.map((module) => {
      const lessons = module.lessons.map((lesson) => {
        position += 1;
        return { lesson, position };
      });
      return {
        module,
        total: module.lessons.length,
        lessons: normalizedQuery
          ? lessons.filter(({ lesson }) =>
              lesson.title.toLowerCase().includes(normalizedQuery),
            )
          : lessons,
      };
    });
  }, [modules, normalizedQuery]);

  const matchCount = groups.reduce((total, group) => total + group.lessons.length, 0);

  return (
    <nav className="member-playlist" aria-label={t("learn.classroom.curriculum.lessons")}>
      <label className="member-playlist__search">
        <Search aria-hidden="true" size={15} strokeWidth={1.8} />
        <span className="sr-only">{t("learn.classroom.curriculum.search")}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("learn.classroom.curriculum.search")}
        />
      </label>
      {normalizedQuery ? (
        <p aria-live="polite" className="member-playlist__count">
          {t(`learn.classroom.curriculum.${matchCount === 1 ? "matchOne" : "matchMany"}`)
            .replace("{count}", () => String(matchCount))
            .replace("{query}", () => query.trim())}
        </p>
      ) : null}

      <ol className="member-playlist__modules">
        {groups.map((group, moduleIndex) => {
          if (normalizedQuery && group.lessons.length === 0) {
            return null;
          }
          const isOpen = normalizedQuery
            ? true
            : !(collapsed[group.module.id] ?? group.module.id !== activeModuleId);
          const doneCount = group.module.lessons.filter((lesson) =>
            completedLessonIds.includes(lesson.id),
          ).length;
          const panelId = `playlist-${group.module.id}`;

          return (
            <li key={group.module.id} className="member-playlist__module">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() =>
                  setCollapsed((current) => ({
                    ...current,
                    [group.module.id]: isOpen,
                  }))
                }
                className="member-playlist__module-head"
              >
                <span className="member-playlist__module-title">
                  <span className="member-playlist__module-eyebrow">
                    {t("learn.classroom.curriculum.module").replace("{number}", () => String(moduleIndex + 1))}
                  </span>
                  {/* The space separates "Module 1" from the title in the button's
                      accessible name; the title grid does not draw it. */}
                  {" "}
                  {group.module.title}
                </span>
                <span className="member-playlist__module-meta">
                  {doneCount}/{group.total}
                  <ChevronDown
                    aria-hidden="true"
                    size={15}
                    strokeWidth={2}
                    className={`member-playlist__chevron ${isOpen ? "is-open" : ""}`}
                  />
                </span>
              </button>

              {isOpen ? (
                <ul id={panelId} className="member-playlist__lessons">
                  {group.lessons.map(({ lesson, position }) => {
                    const isCompleted = completedLessonIds.includes(lesson.id);
                    const isSelected = selectedLessonId === lesson.id;
                    const unlockState = unlockStateById.get(lesson.id);
                    const unlocked = unlockState?.unlocked ?? true;
                    // Scheduled lesson: the date it opens, not just "Locked".
                    const lockedLabel = unlockState?.unlocksAt
                      ? t("learn.classroom.lesson.unlocks").replace("{date}", () =>
                          formatUnlockDate(unlockState.unlocksAt!, locale))
                      : t("learn.classroom.curriculum.locked");

                    return (
                      <li
                        key={lesson.id}
                        ref={isSelected ? currentLessonRef : undefined}
                        className={`member-playlist__lesson ${isSelected ? "is-current" : ""} ${
                          isCompleted ? "is-done" : ""
                        } ${unlocked ? "" : "is-locked"}`}
                      >
                        {isCompleted && onUncomplete ? (
                          <button
                            type="button"
                            onClick={() => onUncomplete(lesson.id)}
                            aria-label={t("learn.classroom.curriculum.markLessonIncomplete").replace("{title}", () => lesson.title)}
                            title={t("learn.classroom.curriculum.markIncomplete")}
                            className="member-playlist__status member-playlist__status--button"
                          >
                            <DrawnCheck size={14} strokeWidth={2.6} animate={justCompletedIds?.has(lesson.id)} />
                          </button>
                        ) : (
                          <span className="member-playlist__status" aria-hidden="true">
                            {isCompleted ? (
                              <DrawnCheck size={14} strokeWidth={2.6} animate={justCompletedIds?.has(lesson.id)} />
                            ) : isSelected ? (
                              <PlayCircle size={15} />
                            ) : unlocked ? (
                              position
                            ) : (
                              <LockKeyhole size={14} />
                            )}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onSelect(lesson.id)}
                          aria-current={isSelected ? "true" : undefined}
                          className="member-playlist__lesson-button"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <LessonThumbnail src={thumbnailUrlByLessonId?.get(lesson.id)} />
                            <span className="min-w-0">
                              <span className="member-playlist__lesson-title">{lesson.title}</span>
                              <span className="member-playlist__lesson-meta">
                                {/* "Now playing" (Hotmart parity): the row's
                                    color alone did not say "this one" to someone who
                                    does not distinguish color; aria-current already told
                                    the screen reader, the text was missing. */}
                                {isSelected ? (
                                  <span className="member-playlist__now">
                                    {t("learn.classroom.curriculum.playingNow")}
                                  </span>
                                ) : null}
                                {/* With no duration, the row does not start with "·". */}
                                {[
                                  lesson.duration,
                                  isCompleted ? t("learn.classroom.curriculum.completed") : "",
                                  unlocked ? "" : lockedLabel,
                                ].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
