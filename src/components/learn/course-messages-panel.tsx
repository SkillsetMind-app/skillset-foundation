"use client";

import { Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { CourseMessage } from "@/domain/course-message";
import { COURSE_MESSAGE_MAX_CHARS } from "@/domain/course-message";
import { formatNotificationTime } from "@/components/account/notification-row";
import {
  sendCourseMessage,
  subscribeToCourseThread,
} from "@/lib/data/course-messages";

// The RPC may reject with a plain Supabase error object. Keep only known public
// reasons in UI state (as dictionary keys) so a later locale change translates
// the same failure; anything else falls back to a safe generic message.
const sendFailureKeys = new Map([
  ["Sign in before sending a message.", "signIn"],
  ["Message cannot be empty.", "emptyBody"],
  ["A valid course id is required.", "invalidCourse"],
  ["A valid student id is required.", "invalidStudent"],
  ["Course not found.", "courseMissing"],
  ["You can only send messages in your own thread.", "wrongThread"],
  ["You cannot message yourself.", "selfMessage"],
  ["Only enrolled students can use course messages.", "enrollFirst"],
  ["This enrollment does not match the thread.", "threadMismatch"],
  ["This enrollment cannot send messages.", "inactiveEnrollment"],
  ["RATE_LIMIT", "rateLimit"],
  ["RATE_LIMIT: too many attempts, please wait before trying again", "rateLimit"],
]);

function sendFailureKey(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  const key = typeof message === "string" ? sendFailureKeys.get(message) : undefined;
  return `learn.classroom.messages.${key ?? "sendError"}`;
}

// Private student->teacher thread for this course, rendered inside the
// members-area workspace next to the community/review panels. One thread per
// enrollment; replies arrive here (and through the notification bell).
// The teacher-branded room has no bell (member-area-shell.tsx), so there the
// description leaves the bell out.
export function CourseMessagesPanel({
  courseId,
  previewMode = false,
  whitelabel = false,
}: {
  courseId: string;
  previewMode?: boolean;
  whitelabel?: boolean;
}) {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [messages, setMessages] = useState<CourseMessage[]>([]);
  // A conversa ainda não chegou: o histórico surgia de repente ACIMA do
  // formulário e empurrava a caixa de texto. Até a primeira leitura (ou a
  // falha), linhas de espera no lugar dele.
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  // A dictionary key, never rendered text: the locale can change while the
  // notice is on screen.
  const [notice, setNotice] = useState("");
  const canSend = !previewMode && Boolean(user);

  useEffect(() => {
    if (!user || previewMode) {
      return;
    }

    return subscribeToCourseThread(
      courseId,
      user.uid,
      (rows) => {
        setMessages(rows);
        setReady(true);
      },
      () => {
        setNotice("learn.classroom.messages.loadError");
        setReady(true);
      },
    );
  }, [courseId, previewMode, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend || !user || !draft.trim()) {
      return;
    }

    setIsSending(true);
    setNotice("");
    try {
      await sendCourseMessage({
        courseId,
        studentId: user.uid,
        body: draft,
      });
      setDraft("");
    } catch (error) {
      setNotice(sendFailureKey(error));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="member-resource-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t("learn.classroom.messages.title")}
        </p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
          {t("learn.classroom.messages.heading")}
        </h4>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t(
            whitelabel
              ? "learn.classroom.messages.descriptionWhitelabel"
              : "learn.classroom.messages.description",
          )}
        </p>
      </div>

      {canSend && !ready ? (
        // Uma linha só, dentro do vão de 20px acima do formulário (altura
        // zero no fluxo): a maioria das conversas chega vazia, e duas bolhas
        // de espera faziam o formulário subir ~124px quando o vazio chegava.
        <div role="status" className="relative h-0">
          <span className="sr-only">{t("learn.classroom.messages.loading")}</span>
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 block h-2 w-2/5 rounded-sm bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse"
          />
        </div>
      ) : messages.length > 0 ? (
        <ul className="mt-5 grid gap-3">
          {messages.map((message) => {
            const isMine = user ? message.senderId === user.uid : false;
            return (
              <li
                key={message.id}
                className={`max-w-[85%] rounded-lg px-4 py-3 ${
                  isMine
                    ? "justify-self-end bg-[rgba(44,82,130,0.08)]"
                    : "justify-self-start border fine-rule bg-white"
                }`}
              >
                <p className="text-xs font-semibold text-[var(--color-ink-muted)]">
                  {t(isMine ? "learn.classroom.messages.you" : "learn.classroom.messages.teacher")} ·{" "}
                  {formatNotificationTime(message.createdAt, t, locale)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink)]">
                  {message.body}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-5 grid gap-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!canSend || isSending}
          maxLength={COURSE_MESSAGE_MAX_CHARS}
          rows={3}
          aria-label={t("learn.classroom.messages.bodyLabel")}
          className="min-h-20 rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
          placeholder={t("learn.classroom.messages.placeholder")}
        />

        {!canSend ? (
          <p className="rounded-md bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-ink-soft)]">
            {t(previewMode ? "learn.classroom.messages.preview" : "learn.classroom.messages.signIn")}
          </p>
        ) : null}

        {/* Erro com cara de erro (caixa da casa, com ícone, lida em voz alta):
            antes era a mesma pílula navy de um aviso neutro. */}
        {notice ? <InlineAlert tone="error">{t(notice)}</InlineAlert> : null}

        <button
          type="submit"
          disabled={!canSend || isSending || !draft.trim()}
          className="button-solid inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
        >
          <Send size={15} aria-hidden="true" />
          {t(isSending ? "learn.classroom.messages.sending" : "learn.classroom.messages.send")}
        </button>
      </form>
    </section>
  );
}
