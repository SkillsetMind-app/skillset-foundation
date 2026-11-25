"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { QuizQuestion } from "@/lib/ai/lesson-text";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// "Check your understanding" below the lesson: the quiz the teacher published.
// Instant self-grading, nothing saved (no grade, no certificate tied to it).
// The read goes through the RLS on lesson_quizzes: enrolled, lesson unlocked,
// quiz published. With no quiz, nothing shows.
//
// Choosing and checking are two steps: on the keyboard, the arrow keys SELECT the option of the
// radio group, so checking on selection would lock in the first attempt.
export function LessonQuiz({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { t } = useTranslation();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // No reset here: the classroom mounts one LessonQuiz per lesson (key={lesson.id}).
    let live = true;
    void getSupabaseBrowserClient()
      .from("lesson_quizzes")
      .select("questions")
      .eq("course_id", courseId)
      .eq("lesson_id", lessonId)
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        if (live && Array.isArray(data?.questions)) setQuestions(data.questions as QuizQuestion[]);
      });
    return () => {
      live = false;
    };
  }, [courseId, lessonId]);

  if (questions.length === 0) return null;
  const done = questions.every((_, index) => checked[index]);
  const right = questions.filter((question, index) => checked[index] && chosen[index] === question.answer).length;
  const headingId = `lesson-quiz-${lessonId}`;

  return (
    // The quiz arrives after the rest of the lesson (its own read): it comes in with the
    // system's short rise instead of appearing all at once and pushing the
    // page down. h3: a subsection of the lesson, which is the panel's h2.
    <section aria-labelledby={headingId} className="motion-rise-in mt-6 grid gap-4 rounded-lg border border-[var(--color-line)] p-4">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-[var(--color-ink)] outline-none">
        {t("learn.classroom.quiz.title")}
      </h3>
      {questions.map((question, index) => {
        const choice = chosen[index];
        const isChecked = Boolean(checked[index]);
        return (
          <fieldset key={index} className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-[var(--color-ink)]">{question.question}</legend>
            {question.options.map((option, optionIndex) => {
              // Once checked, the question marks the right one (border and check) and, if the
              // choice was a different one, the chosen one (border and X). Before, only a gray
              // word below changed. Colors from the course palette, falling back
              // to the platform's.
              const mark = !isChecked
                ? null
                : optionIndex === question.answer
                  ? "right"
                  : optionIndex === choice
                    ? "wrong"
                    : null;
              return (
                <label
                  key={optionIndex}
                  data-quiz-mark={mark ?? undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-md border px-2 text-sm text-[var(--color-ink)] ${
                    mark === "right"
                      ? "border-[var(--ma-success-ink,var(--color-success-fg))]"
                      : mark === "wrong"
                        ? "border-[var(--ma-accent-ink,var(--color-danger-fg))]"
                        : "border-transparent"
                  }`}
                >
                  <input
                    type="radio"
                    name={`lesson-quiz-${lessonId}-${index}`}
                    checked={choice === optionIndex}
                    disabled={isChecked}
                    onChange={() => setChosen((current) => ({ ...current, [index]: optionIndex }))}
                    className="h-5 w-5 shrink-0 accent-[var(--ma-accent,var(--color-primary))]"
                  />
                  {option}
                  {mark === "right" ? (
                    <CheckCircle2 size={16} aria-hidden className="ml-auto shrink-0 text-[var(--ma-success-ink,var(--color-success-fg))]" />
                  ) : mark === "wrong" ? (
                    <XCircle size={16} aria-hidden className="ml-auto shrink-0 text-[var(--ma-accent-ink,var(--color-danger-fg))]" />
                  ) : null}
                </label>
              );
            })}
            {isChecked ? null : (
              <button
                type="button"
                className="button-outline min-h-11 justify-self-start px-3 text-sm"
                disabled={choice === undefined}
                onClick={() => setChecked((current) => ({ ...current, [index]: true }))}
              >
                {t("learn.classroom.quiz.check")}
              </button>
            )}
            <p aria-live="polite" className="text-sm text-[var(--color-ink-soft)]">
              {isChecked ? (
                <>
                  <strong>{t(choice === question.answer ? "learn.classroom.quiz.correct" : "learn.classroom.quiz.incorrect")}</strong>{" "}
                  {choice === question.answer
                    ? null
                    : `${t("learn.classroom.quiz.answer").replace("{option}", () => question.options[question.answer])} `}
                  {question.explanation}
                </>
              ) : null}
            </p>
          </fieldset>
        );
      })}
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-ink-soft)]">
        {done ? (
          <>
            <span>
              {t("learn.classroom.quiz.score")
                .replace("{right}", () => String(right))
                .replace("{total}", () => String(questions.length))}
            </span>
            <button
              type="button"
              className="button-outline min-h-11 px-3 text-sm"
              onClick={() => {
                setChosen({});
                setChecked({});
                // The button disappears on restart: focus goes back to the quiz title.
                headingRef.current?.focus();
              }}
            >
              {t("learn.classroom.quiz.retry")}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
