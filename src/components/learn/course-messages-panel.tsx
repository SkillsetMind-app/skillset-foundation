"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
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
  // The conversation has not arrived yet: the history showed up suddenly ABOVE the
  // form and pushed the text box. Until the first read (or the
  // failure), wait rows in its place.
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  // A dictionary key, never rendered text: the locale can change while the
  // notice is on screen.
  const [notice, setNotice] = useState("");
  // The read failure stays in place of the conversation, with "Try again" (which subscribes
  // again); the notice below is only for sending.
  const [loadFailed, setLoadFailed] = useState(false);
  const [threadAttempt, setThreadAttempt] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
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
        setLoadFailed(false);
        setReady(true);
      },
      () => {
        setLoadFailed(true);
        setReady(true);
      },
    );
  }, [courseId, previewMode, user, threadAttempt]);

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
    <section ref={panelRef} tabIndex={-1} className="member-resource-panel">
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
        // One line only, inside the 20px gap above the form (zero
        // height in the flow): most conversations arrive empty, and two wait
        // bubbles made the form jump up ~124px when the empty state arrived.
        <div role="status" className="relative h-0">
          <span className="sr-only">{t("learn.classroom.messages.loading")}</span>
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 block h-2 w-2/5 rounded-sm bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse"
          />
        </div>
      ) : loadFailed ? (
        <LoadErrorAlert
          className="mt-5"
          focusRef={panelRef}
          onRetry={() => {
            setLoadFailed(false);
            setReady(false);
            setThreadAttempt((attempt) => attempt + 1);
          }}
        >
          {t("learn.classroom.messages.loadError")}
        </LoadErrorAlert>
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
          className="field-input min-h-20"
          placeholder={t("learn.classroom.messages.placeholder")}
        />

        {!canSend ? (
          <p className="rounded-md bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-ink-soft)]">
            {t(previewMode ? "learn.classroom.messages.preview" : "learn.classroom.messages.signIn")}
          </p>
        ) : null}

        {/* An error that looks like an error (the app's own box, with an icon, read aloud):
            before it was the same navy pill as a neutral notice. */}
        {notice ? <InlineAlert tone="error">{t(notice)}</InlineAlert> : null}

        <button
          type="submit"
          disabled={!canSend || isSending || !draft.trim()}
          className="button-solid inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm"
        >
          <Send size={15} aria-hidden="true" />
          <BusyLabel
            busy={isSending}
            idle={t("learn.classroom.messages.send")}
            busyText={t("learn.classroom.messages.sending")}
          />
        </button>
      </form>
    </section>
  );
}
