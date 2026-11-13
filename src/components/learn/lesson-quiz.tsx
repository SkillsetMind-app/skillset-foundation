"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { QuizQuestion } from "@/lib/ai/lesson-text";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// "Check your understanding" abaixo da aula: o quiz que o professor publicou.
// Autocorreção na hora, nada gravado (sem nota, sem certificado ligado a ele).
// A leitura passa pela RLS de lesson_quizzes: matriculado, aula liberada,
// quiz publicado. Sem quiz, nada aparece.
export function LessonQuiz({ lessonId }: { lessonId: string }) {
  const { t } = useTranslation();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [picked, setPicked] = useState<Record<number, number>>({});

  useEffect(() => {
    let live = true;
    setQuestions([]);
    setPicked({});
    void getSupabaseBrowserClient()
      .from("lesson_quizzes")
      .select("questions")
      .eq("lesson_id", lessonId)
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        if (live && Array.isArray(data?.questions)) setQuestions(data.questions as QuizQuestion[]);
      });
    return () => {
      live = false;
    };
  }, [lessonId]);

  if (questions.length === 0) return null;
  const answered = Object.keys(picked).length;
  const right = questions.filter((question, index) => picked[index] === question.answer).length;

  return (
    <section aria-labelledby={`lesson-quiz-${lessonId}`} className="mt-6 grid gap-4 rounded-lg border border-[var(--color-line)] p-4">
      <h5 id={`lesson-quiz-${lessonId}`} className="text-base font-semibold text-[var(--color-ink)]">
        {t("learn.classroom.quiz.title")}
      </h5>
      {questions.map((question, index) => {
        const choice = picked[index];
        return (
          <fieldset key={index} className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-[var(--color-ink)]">{question.question}</legend>
            {question.options.map((option, optionIndex) => (
              <label key={optionIndex} className="flex min-h-11 items-center gap-3 text-sm text-[var(--color-ink)]">
                <input
                  type="radio"
                  name={`lesson-quiz-${lessonId}-${index}`}
                  checked={choice === optionIndex}
                  disabled={choice !== undefined}
                  onChange={() => setPicked((current) => ({ ...current, [index]: optionIndex }))}
                  className="h-5 w-5 shrink-0"
                />
                {option}
              </label>
            ))}
            {choice !== undefined ? (
              <p className="text-sm text-[var(--color-ink-soft)]">
                <strong>{t(choice === question.answer ? "learn.classroom.quiz.correct" : "learn.classroom.quiz.incorrect")}</strong>{" "}
                {question.explanation}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-ink-soft)]">
        {answered === questions.length ? (
          <>
            <span>
              {t("learn.classroom.quiz.score")
                .replace("{right}", () => String(right))
                .replace("{total}", () => String(questions.length))}
            </span>
            <button type="button" className="button-outline min-h-11 px-3 text-sm" onClick={() => setPicked({})}>
              {t("learn.classroom.quiz.retry")}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
