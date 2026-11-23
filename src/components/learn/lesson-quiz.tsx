"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { QuizQuestion } from "@/lib/ai/lesson-text";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// "Check your understanding" abaixo da aula: o quiz que o professor publicou.
// Autocorreção na hora, nada gravado (sem nota, sem certificado ligado a ele).
// A leitura passa pela RLS de lesson_quizzes: matriculado, aula liberada,
// quiz publicado. Sem quiz, nada aparece.
//
// Escolher e conferir são dois passos: no teclado, as setas MARCAM a opção do
// grupo de rádio, então conferir na marcação travaria a primeira tentativa.
export function LessonQuiz({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { t } = useTranslation();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Sem reset aqui: a sala de aula monta um LessonQuiz por aula (key={lesson.id}).
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
    // O quiz chega depois do resto da aula (leitura própria): entra com a
    // subida curta do sistema em vez de aparecer de uma vez empurrando a
    // página. h3: subseção da aula, que é o h2 do painel.
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
              // Conferida, a pergunta marca a certa (borda e check) e, se a
              // escolha foi outra, a escolhida (borda e X). Antes so mudava uma
              // palavra cinza embaixo. Cores da paleta do curso, com reserva
              // na da plataforma.
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
                className="button-outline min-h-11 justify-self-start px-3 text-sm disabled:opacity-60"
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
                // O botão some com o recomeço: o foco volta ao título do quiz.
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
