"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { RetryAlert } from "@/components/teacher/save-status-line";
import { useConfirm } from "@/components/teacher/use-confirm";
import { Button } from "@/components/ui";
import { callTeachAi, loadTeachAi, teachAiErrorText } from "@/lib/ai/teach-ai-client";
import type { QuizQuestion } from "@/lib/ai/lesson-text";

// Lesson quiz in the studio: the AI writes it from the caption; the teacher edits the
// text, changes the right answer, deletes a question and publishes. Once published, the learner
// sees "Check your understanding" below the lesson.

type Quiz = { questions: QuizQuestion[]; status: "draft" | "published" };

export function LessonAiQuiz({ courseId, lessonId, assetId }: { courseId: string; lessonId: string; assetId: string }) {
  const { t } = useTranslation();
  const { ask, dialog: confirmDialog } = useConfirm();
  // undefined = loading; "error" = could not be read (does not offer to generate over it).
  const [quiz, setQuiz] = useState<Quiz | null | undefined | "error">(undefined);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The error keeps the request that failed: "Try again" repeats exactly that one.
  const [notice, setNotice] = useState<
    { kind: "ok"; text: string } | { kind: "error"; text: string; retry: () => void } | null
  >(null);
  // Each read attempt. Without it, a quiz that failed to load left the
  // panel with only the error sentence, with no button.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadTeachAi({ courseId, lessonId, assetId }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setQuiz("error");
        setNotice({
          kind: "error",
          text: teachAiErrorText(result, t),
          retry: () => {
            setQuiz(undefined);
            setNotice(null);
            setAttempt((current) => current + 1);
          },
        });
        return;
      }
      setQuiz((result.body.quiz as Quiz | null) ?? null);
    });
    return () => {
      live = false;
    };
  }, [courseId, lessonId, assetId, t, attempt]);

  async function run(payload: Record<string, unknown>, key: string, okText: string) {
    setBusy(key);
    setNotice(null);
    const result = await callTeachAi({ courseId, lessonId, assetId, ...payload });
    setBusy(null);
    if (!result.ok) {
      setNotice({ kind: "error", text: teachAiErrorText(result, t), retry: () => void run(payload, key, okText) });
      return;
    }
    setQuiz((result.body.quiz as Quiz | null) ?? null);
    setDirty(false);
    setNotice({ kind: "ok", text: okText });
  }

  function edit(index: number, patch: Partial<QuizQuestion>) {
    setQuiz((current) => current && current !== "error" ? {
      ...current,
      questions: current.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    } : current);
    setDirty(true);
    dropStaleRetry();
  }

  function removeQuestion(index: number) {
    setQuiz((current) => current && current !== "error"
      ? { ...current, questions: current.questions.filter((_, i) => i !== index) }
      : current);
    setDirty(true);
    dropStaleRetry();
  }

  // Edited after the failure: repeating the old request would save the old
  // questions over the new ones. The error goes away; Save uses the quiz on screen.
  function dropStaleRetry() {
    setNotice((current) => (current?.kind === "error" ? null : current));
  }

  const working = busy !== null;
  const loaded = quiz !== undefined && quiz !== "error";
  const current = loaded && quiz ? quiz : null;
  const published = current?.status === "published";

  return (
    <section aria-labelledby="lesson-ai-quiz-title" aria-busy={working || quiz === undefined} className="grid min-w-0 gap-3">
      <h4 id="lesson-ai-quiz-title" className="text-sm font-semibold">{t("creatorEditor.lesson.ai.quizTitle")}</h4>
      <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.ai.quizHelp")}</p>

      {/* The shape of what comes next (the generate button), not a loose sentence (F-03).
          The section's aria-busy already says it is loading. */}
      {quiz === undefined ? (
        <div className="animate-pulse">
          <span className="sr-only">{t("creatorEditor.lesson.ai.loading")}</span>
          <div aria-hidden="true" className="h-11 w-40 rounded-md bg-[var(--color-surface-strong)]" />
        </div>
      ) : current ? (
        <>
          <p className="text-sm font-semibold">
            {t(dirty
              ? "creatorEditor.lesson.ai.unsaved"
              : published ? "creatorEditor.lesson.ai.quizPublished" : "creatorEditor.lesson.ai.quizDraft")}
          </p>
          {current.questions.map((question, index) => (
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
              <button type="button" className="button-danger justify-self-start px-3.5 py-2 text-xs"
                disabled={working || current.questions.length === 1} onClick={() => removeQuestion(index)}>
                {t("creatorEditor.lesson.ai.removeQuestion")}
              </button>
            </fieldset>
          ))}
        </>
      ) : null}

      {loaded ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={working}
            loading={busy === "generate"}
            busyLabel={t("creatorEditor.lesson.ai.generatingQuiz")}
            onClick={() => {
              const generate = () => {
                void run({ action: "generateQuiz" }, "generate", t("creatorEditor.lesson.ai.quizGenerated"));
              };
              // New questions replace the edited ones and take the quiz offline until it is published again.
              if (!current) return generate();
              ask({
                title: t("creatorEditor.lesson.ai.confirmRegenerateQuizTitle"),
                body: t("creatorEditor.lesson.ai.confirmRegenerateQuiz"),
                confirmLabel: t("creatorEditor.lesson.ai.regenerateQuiz"),
                danger: true,
                run: generate,
              });
            }}
          >
            {t(current ? "creatorEditor.lesson.ai.regenerateQuiz" : "creatorEditor.lesson.ai.generateQuiz")}
          </Button>
          {current ? (
            <>
              <button type="button" className="button-outline min-h-11 px-3 text-sm"
                disabled={working || !dirty}
                onClick={() => void run({ action: "saveQuiz", questions: current.questions, publish: published }, "save",
                  t("creatorEditor.lesson.ai.saved"))}>
                {t(published ? "creatorEditor.lesson.ai.saveAndUpdate" : "creatorEditor.lesson.ai.save")}
              </button>
              <button type="button" className="button-solid min-h-11 px-4 py-2.5 text-sm"
                disabled={working}
                onClick={() => void run({ action: "saveQuiz", questions: current.questions, publish: !published }, "publish",
                  t(published ? "creatorEditor.lesson.ai.quizUnpublished" : "creatorEditor.lesson.ai.quizPublishedNotice"))}>
                {t(published ? "creatorEditor.lesson.ai.unpublish" : "creatorEditor.lesson.ai.publish")}
              </button>
              <button type="button" className="button-danger px-3.5 py-2 text-xs"
                disabled={working}
                onClick={() => ask({
                  title: t("creatorEditor.lesson.ai.confirmRemoveQuizTitle"),
                  body: t("creatorEditor.lesson.ai.confirmRemoveQuiz"),
                  confirmLabel: t("creatorEditor.lesson.ai.removeQuiz"),
                  danger: true,
                  run: () => {
                    void run({ action: "removeQuiz" }, "remove", t("creatorEditor.lesson.ai.quizRemoved"));
                  },
                })}>
                {t("creatorEditor.lesson.ai.removeQuiz")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="text-sm text-[var(--color-ink-soft)]">
        {notice?.kind === "ok" ? notice.text : ""}
      </p>
      {notice?.kind === "error" ? <RetryAlert text={notice.text} onRetry={notice.retry} /> : null}
      {confirmDialog}
    </section>
  );
}
