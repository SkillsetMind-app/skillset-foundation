"use client";

import { Inbox, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { formatNotificationTime } from "@/components/account/notification-row";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { courseMessageErrorKey } from "@/components/teacher/course-student-roster";
import { InlineAlert } from "@/components/ui/inline-alert";
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
  // Mesmo molde da caixa do aluno (student-messages-inbox.tsx): ate a primeira
  // leitura a caixa esta "carregando", nao "vazia" (antes abria em "No student
  // messages yet" e depois trocava pelas conversas). A primeira leitura que
  // falha vira erro com "Try again"; uma releitura que falha com a lista na
  // tela vira so um aviso no topo.
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let loaded = false;
    const current = subscribeToTeacherMessages(
      user.uid,
      (next) => {
        loaded = true;
        setMessages(next);
        setReady(true);
        setLoadFailed(false);
        setReloadFailed(false);
      },
      () => {
        if (loaded) {
          setReloadFailed(true);
        } else {
          setLoadFailed(true);
        }
      },
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [user]);

  // "Try again" le de novo pelo mesmo canal, sem desligar e religar.
  function retryLoad() {
    setLoadFailed(false);
    void subscription.current?.reload();
  }

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

  if (loadFailed) {
    return (
      <section className="rounded-lg border fine-rule bg-white p-5">
        <InlineAlert tone="error">{t("teacherMessages.loadError")}</InlineAlert>
        <button type="button" onClick={retryLoad} className="button-outline mt-4 px-4 text-sm">
          {t("appErrors.retry")}
        </button>
      </section>
    );
  }

  if (!ready) {
    return (
      <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
        <p className="sr-only" role="status">
          {t("teacherMessages.loading")}
        </p>
        <div aria-hidden="true" className="grid content-start gap-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-[100px] animate-pulse rounded-lg bg-[var(--color-surface-soft)]" />
          ))}
        </div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <section className="rounded-lg border fine-rule bg-white px-6 py-10 text-center">
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
        {reloadFailed ? (
          <InlineAlert tone="error" className="mt-4">
            {t("teacherMessages.loadError")}
          </InlineAlert>
        ) : null}
      </section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
      {reloadFailed ? (
        <InlineAlert tone="error" className="lg:col-span-2">
          {t("teacherMessages.loadError")}
        </InlineAlert>
      ) : null}
      <nav aria-label={t("teacherMessages.threads")} className="grid content-start gap-2">
        {threads.map((thread) => {
          const isActive = selectedThread?.key === thread.key;
          return (
            <button
              key={thread.key}
              type="button"
              onClick={() => setSelectedKey(thread.key)}
              className={`rounded-lg border px-4 py-3 text-left transition ${
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
        <section className="rounded-lg border fine-rule bg-white p-5">
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
                  className={`max-w-[85%] rounded-lg px-4 py-3 ${
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
              className="min-h-20 rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
              aria-label={t("teacherMessages.replyTo").replace("{name}", () => selectedThread.studentName)}
              placeholder={t("teacherMessages.replyTo").replace("{name}", () => selectedThread.studentName)}
            />
            {notice ? (
              <p className="rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-primary)]">
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
