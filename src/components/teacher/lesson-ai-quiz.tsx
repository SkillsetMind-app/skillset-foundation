"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { callTeachAi, loadTeachAi } from "@/lib/ai/teach-ai-client";
import type { QuizQuestion } from "@/lib/ai/lesson-text";

// Quiz da aula no estúdio: a IA escreve a partir da legenda; o professor edita
// texto, troca a resposta certa, apaga pergunta e publica. Publicado, o aluno
// vê "Check your understanding" abaixo da aula.

type Quiz = { questions: QuizQuestion[]; status: "draft" | "published" };

export function LessonAiQuiz({ courseId, lessonId, assetId }: { courseId: string; lessonId: string; assetId: string }) {
  const { t } = useTranslation();
  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void loadTeachAi({ courseId, lessonId, assetId }).then((result) => {
      if (!live) return;
      setQuiz(result.ok ? ((result.body.quiz as Quiz | null) ?? null) : null);
    });
    return () => {
      live = false;
    };
  }, [courseId, lessonId, assetId]);

  async function run(payload: Record<string, unknown>, key: string, okText: string) {
    setBusy(key);
    setNotice(null);
    const result = await callTeachAi({ courseId, lessonId, assetId, ...payload });
    setBusy(null);
    if (!result.ok) {
      setNotice({ kind: "error", text: result.body.error ?? t("creatorEditor.lesson.ai.errorGeneric") });
      return;
    }
    setQuiz((result.body.quiz as Quiz | null) ?? null);
    setDirty(false);
    setNotice({ kind: "ok", text: okText });
  }

  function edit(index: number, patch: Partial<QuizQuestion>) {
    setQuiz((current) => current && {
      ...current,
      questions: current.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    });
    setDirty(true);
  }

  function removeQuestion(index: number) {
    setQuiz((current) => current && { ...current, questions: current.questions.filter((_, i) => i !== index) });
    setDirty(true);
  }

  const working = busy !== null;
  const published = quiz?.status === "published";

  return (
    <section aria-labelledby="lesson-ai-quiz-title" className="grid min-w-0 gap-3">
      <h4 id="lesson-ai-quiz-title" className="text-sm font-semibold">{t("creatorEditor.lesson.ai.quizTitle")}</h4>
      <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.ai.quizHelp")}</p>

      {quiz === undefined ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.ai.loading")}</p>
      ) : quiz === null ? null : (
        <>
          <p className="text-sm font-semibold">
            {t(published ? "creatorEditor.lesson.ai.quizPublished" : "creatorEditor.lesson.ai.quizDraft")}
          </p>
          {quiz.questions.map((question, index) => (
            <fieldset key={index} className="grid gap-2 rounded-md border border-[var(--color-line)] p-3">
              <legend className="px-1 text-xs font-semibold">
                {t("creatorEditor.lesson.ai.questionNumber").replace("{n}", () => String(index + 1))}
              </legend>
              <label className="lesson-modal-field">
                <span>{t("creatorEditor.lesson.ai.question")}</span>
                <textarea rows={2} value={question.question} disabled={working}
                  onChange={(event) => edit(index, { question: event.target.value })} />
              </label>
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`quiz-${lessonId}-${index}`}
                    checked={question.answer === optionIndex}
                    disabled={working}
                    onChange={() => edit(index, { answer: optionIndex })}
                    aria-label={t("creatorEditor.lesson.ai.markCorrect").replace("{n}", () => String(optionIndex + 1))}
                    className="h-5 w-5 shrink-0"
                  />
                  <label className="lesson-modal-field min-w-0 flex-1">
                    <span className="sr-only">
                      {t("creatorEditor.lesson.ai.option").replace("{n}", () => String(optionIndex + 1))}
                    </span>
                    <input value={option} disabled={working}
                      onChange={(event) => edit(index, {
                        options: question.options.map((value, i) => (i === optionIndex ? event.target.value : value)),
                      })} />
                  </label>
                </div>
              ))}
              <label className="lesson-modal-field">
                <span>{t("creatorEditor.lesson.ai.explanation")}</span>
                <textarea rows={2} value={question.explanation} disabled={working}
                  onChange={(event) => edit(index, { explanation: event.target.value })} />
              </label>
              <button type="button" className="button-danger justify-self-start px-3.5 py-2 text-xs disabled:opacity-60"
                disabled={working || quiz.questions.length === 1} onClick={() => removeQuestion(index)}>
                {t("creatorEditor.lesson.ai.removeQuestion")}
              </button>
            </fieldset>
          ))}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="button-outline min-h-11 px-3 text-sm disabled:opacity-60"
          disabled={working || quiz === undefined}
          onClick={() => run({ action: "generateQuiz" }, "generate", t("creatorEditor.lesson.ai.quizGenerated"))}
        >
          {busy === "generate"
            ? t("creatorEditor.lesson.ai.generatingQuiz")
            : t(quiz ? "creatorEditor.lesson.ai.regenerateQuiz" : "creatorEditor.lesson.ai.generateQuiz")}
        </button>
        {quiz ? (
          <>
            <button type="button" className="button-outline min-h-11 px-3 text-sm disabled:opacity-60"
              disabled={working || !dirty}
              onClick={() => run({ action: "saveQuiz", questions: quiz.questions, publish: published }, "save",
                t("creatorEditor.lesson.ai.saved"))}>
              {t("creatorEditor.lesson.ai.save")}
            </button>
            <button type="button" className="button-solid min-h-11 px-4 py-2.5 text-sm disabled:opacity-60"
              disabled={working}
              onClick={() => run({ action: "saveQuiz", questions: quiz.questions, publish: !published }, "publish",
                t(published ? "creatorEditor.lesson.ai.quizUnpublished" : "creatorEditor.lesson.ai.quizPublishedNotice"))}>
              {t(published ? "creatorEditor.lesson.ai.unpublish" : "creatorEditor.lesson.ai.publish")}
            </button>
            <button type="button" className="button-danger px-3.5 py-2 text-xs disabled:opacity-60"
              disabled={working}
              onClick={() => run({ action: "removeQuiz" }, "remove", t("creatorEditor.lesson.ai.quizRemoved"))}>
              {t("creatorEditor.lesson.ai.removeQuiz")}
            </button>
          </>
        ) : null}
      </div>

      <p role="status" aria-live="polite"
        className={notice?.kind === "error" ? "text-sm font-semibold text-[var(--color-danger-fg)]" : "text-sm text-[var(--color-ink-soft)]"}>
        {notice?.text ?? ""}
      </p>
    </section>
  );
}
