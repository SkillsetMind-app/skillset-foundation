"use client";

import { Inbox, Send } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { formatNotificationTime } from "@/components/account/notification-row";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { courseMessageErrorKey } from "@/components/teacher/course-student-roster";
import type { CourseMessage } from "@/domain/course-message";
import {
  COURSE_MESSAGE_MAX_CHARS,
  groupCourseMessageThreads,
} from "@/domain/course-message";
import {
  sendCourseMessage,
  subscribeToTeacherMessages,
} from "@/lib/data/course-messages";

// Teacher inbox: every student thread across the teacher's courses, grouped
// per (course, student). Selecting a thread shows the conversation and a
// reply composer — replies go through the same enrollment-gated RPC.
export function TeacherMessagesInbox() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherMessages(
      user.uid,
      setMessages,
      () => {
        setNotice("teacherMessages.loadError");
      },
    );
  }, [user]);

  const threads = useMemo(
    () => groupCourseMessageThreads(messages),
    [messages],
  );
  const selectedThread =
    threads.find((thread) => thread.key === selectedKey) ?? threads[0] ?? null;

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThread || !draft.trim() || isSending) {
      return;
    }

    setIsSending(true);
    setNotice("");
    try {
      await sendCourseMessage({
        courseId: selectedThread.courseId,
        studentId: selectedThread.studentId,
        body: draft,
      });
      setDraft("");
    } catch (sendError) {
      setNotice(courseMessageErrorKey(sendError, "teacherMessages.sendError"));
    } finally {
      setIsSending(false);
    }
  }

  if (threads.length === 0) {
    return (
      <section className="rounded-[16px] border fine-rule bg-white px-6 py-10 text-center">
        <Inbox
          aria-hidden="true"
          className="mx-auto text-[var(--color-ink-muted)]"
          size={28}
        />
        <h3 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
          {t("teacherMessages.emptyTitle")}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("teacherMessages.emptyDescription")}
        </p>
        {notice ? (
          <p className="mt-4 text-xs font-semibold text-[var(--color-primary)]">
            {t(notice)}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
      <nav aria-label={t("teacherMessages.threads")} className="grid content-start gap-2">
        {threads.map((thread) => {
          const isActive = selectedThread?.key === thread.key;
          return (
            <button
              key={thread.key}
              type="button"
              onClick={() => setSelectedKey(thread.key)}
              className={`rounded-[12px] border px-4 py-3 text-left transition ${
                isActive
                  ? "border-[var(--color-primary)] bg-[rgba(44,82,130,0.06)]"
                  : "fine-rule bg-white hover:border-[var(--color-primary)]"
              }`}
            >
              <p className="text-sm font-semibold text-[var(--color-primary)]">
                {thread.studentName}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-[var(--color-ink-muted)]">
                {thread.courseTitle}
              </p>
              <p className="mt-1 truncate text-xs leading-5 text-[var(--color-ink-soft)]">
                {thread.lastMessage.body}
              </p>
              <p className="mt-1 text-[11px] font-medium text-[var(--color-ink-muted)]">
                {formatNotificationTime(thread.lastMessage.createdAt, t, locale)}
              </p>
            </button>
          );
        })}
      </nav>

      {selectedThread ? (
        <section className="rounded-[16px] border fine-rule bg-white p-5">
          <div className="border-b fine-rule pb-3">
            <h3 className="text-base font-semibold text-[var(--color-primary)]">
              {selectedThread.studentName}
            </h3>
            <p className="mt-0.5 text-xs font-semibold text-[var(--color-ink-muted)]">
              {selectedThread.courseTitle}
            </p>
          </div>

          <ul className="mt-4 grid gap-3">
            {selectedThread.messages.map((message) => {
              const isMine = user ? message.senderId === user.uid : false;
              return (
                <li
                  key={message.id}
                  className={`max-w-[85%] rounded-[12px] px-4 py-3 ${
                    isMine
                      ? "justify-self-end bg-[rgba(44,82,130,0.08)]"
                      : "justify-self-start bg-[var(--color-surface-soft)]"
                  }`}
                >
                  <p className="text-xs font-semibold text-[var(--color-ink-muted)]">
                    {isMine ? t("teacherMessages.you") : selectedThread.studentName} ·{" "}
                    {formatNotificationTime(message.createdAt, t, locale)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink)]">
                    {message.body}
                  </p>
                </li>
              );
            })}
          </ul>

          <form onSubmit={handleReply} className="mt-5 grid gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={isSending}
              maxLength={COURSE_MESSAGE_MAX_CHARS}
              rows={3}
              className="min-h-20 rounded-[12px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
              aria-label={t("teacherMessages.replyTo").replace("{name}", () => selectedThread.studentName)}
              placeholder={t("teacherMessages.replyTo").replace("{name}", () => selectedThread.studentName)}
            />
            {notice ? (
              <p className="rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-primary)]">
                {t(notice)}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSending || !draft.trim()}
              className="button-solid inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
            >
              <Send size={15} aria-hidden="true" />
              {t(isSending ? "teacherMessages.sending" : "teacherMessages.send")}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
