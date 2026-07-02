"use client";

import { Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { CourseMessage } from "@/domain/course-message";
import { COURSE_MESSAGE_MAX_CHARS } from "@/domain/course-message";
import { formatNotificationTime } from "@/components/account/notification-row";
import {
  sendCourseMessage,
  subscribeToCourseThread,
} from "@/lib/data/course-messages";

// Private student->teacher thread for this course, rendered inside the
// members-area workspace next to the community/review panels. One thread per
// enrollment; replies arrive here (and through the notification bell).
export function CourseMessagesPanel({
  courseId,
  previewMode = false,
}: {
  courseId: string;
  previewMode?: boolean;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const canSend = !previewMode && Boolean(user);

  useEffect(() => {
    if (!user || previewMode) {
      return;
    }

    return subscribeToCourseThread(
      courseId,
      user.uid,
      setMessages,
      () => {
        setNotice("We could not load your messages.");
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
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "We could not send your message. Try again.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="member-resource-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Message your teacher
        </p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
          Ask a private question about this course
        </h4>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Only you and the course teacher can read this thread. Replies also
          land in your notification bell.
        </p>
      </div>

      {messages.length > 0 ? (
        <ul className="mt-5 grid gap-3">
          {messages.map((message) => {
            const isMine = user ? message.senderId === user.uid : false;
            return (
              <li
                key={message.id}
                className={`max-w-[85%] rounded-[12px] px-4 py-3 ${
                  isMine
                    ? "justify-self-end bg-[rgba(44,82,130,0.08)]"
                    : "justify-self-start border fine-rule bg-white"
                }`}
              >
                <p className="text-xs font-semibold text-[var(--color-ink-muted)]">
                  {isMine ? "You" : "Teacher"} ·{" "}
                  {formatNotificationTime(message.createdAt)}
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
          className="min-h-20 rounded-[12px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
          placeholder="Write a private message to your teacher..."
        />

        {!canSend ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-ink-soft)]">
            {previewMode
              ? "Preview mode cannot send messages."
              : "Sign in to message your teacher."}
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-primary)]">
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSend || isSending || !draft.trim()}
          className="button-solid inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
        >
          <Send size={15} aria-hidden="true" />
          {isSending ? "Sending..." : "Send message"}
        </button>
      </form>
    </section>
  );
}
