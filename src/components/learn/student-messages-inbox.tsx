"use client";

import { ArrowLeft, Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { formatNotificationTime } from "@/components/account/notification-row";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { CourseMessage } from "@/domain/course-message";
import {
  COURSE_MESSAGE_MAX_CHARS,
  groupCourseMessageThreads,
} from "@/domain/course-message";
import {
  sendCourseMessage,
  subscribeToStudentMessages,
} from "@/lib/data/course-messages";

// The learner's message inbox (/learn/messages).
//
// WHY THIS EXISTS
//
// To reply to the teacher you had to scroll four or five screens to the
// bottom of the lesson page, after the community. With three courses, three
// places. The learner had no list of conversations; the teacher did
// (teacher-messages-inbox.tsx, the model for this file). One conversation per
// course; the open conversation goes in the address (?course=), so sharing it
// opens the same one, and the browser's back button returns to the list.
export function StudentMessagesInbox() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const pathname = usePathname() ?? "/learn/messages";
  const searchParams = useSearchParams();
  const courseParam = searchParams?.get("course") ?? null;

  const [messages, setMessages] = useState<CourseMessage[]>([]);
  // Until the first read arrives, the list is "loading", not "empty":
  // before, every visit showed "No conversations yet" and then swapped in the
  // conversations. If the first read fails, the error with "Try again" takes
  // the place of the empty state (a failure is not "you have no conversations").
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // A re-read failed while the list is already on screen: a notice at the top,
  // with or without an open conversation, and it goes away when a later read
  // succeeds.
  const [reloadFailed, setReloadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let loaded = false;
    const current = subscribeToStudentMessages(
      user.uid,
      (next) => {
        loaded = true;
        setMessages(next);
        setReady(true);
        setLoadFailed(false);
        setReloadFailed(false);
      },
      () => {
        // A failure on a re-read (the realtime channel reloads) does not wipe
        // the list already on screen: it only becomes the notice.
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

  // "Try again" reads again through the same channel, without leaving and
  // rejoining Realtime (in the gap, a new message would be lost).
  function retryLoad() {
    setLoadFailed(false);
    void subscription.current?.reload();
  }

  // For the learner, each thread is a course (the key is course + the learner).
  const threads = useMemo(() => groupCourseMessageThreads(messages), [messages]);
  const selectedThread =
    threads.find((thread) => thread.courseId === courseParam) ?? null;

  function openThread(courseId: string) {
    router.push(`${pathname}?course=${encodeURIComponent(courseId)}`);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !selectedThread || !draft.trim() || isSending) {
      return;
    }

    setIsSending(true);
    setNotice("");
    try {
      await sendCourseMessage({
        courseId: selectedThread.courseId,
        studentId: user.uid,
        body: draft,
      });
      setDraft("");
    } catch {
      setNotice("learnWave2.messages.sendError");
    } finally {
      setIsSending(false);
    }
  }

  // Back is always the arrow in the top left corner, one level up:
  // conversation -> list -> dashboard.
  const backHref = selectedThread ? pathname : "/learn";
  const backLabel = selectedThread ? t("learnWave2.messages.all") : t("learnWave2.messages.back");

  return (
    <div className="grid gap-5">
      <Link
        href={backHref}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-[var(--color-primary)]"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {backLabel}
      </Link>

      {reloadFailed ? (
        <InlineAlert tone="error">{t("learnWave2.messages.loadError")}</InlineAlert>
      ) : null}

      {loadFailed ? (
        <section className="rounded-lg border fine-rule bg-white p-5">
          <InlineAlert tone="error">{t("learnWave2.messages.loadError")}</InlineAlert>
          <button type="button" onClick={retryLoad} className="button-outline mt-4 px-4 text-sm">
            {t("learnWave2.messages.retry")}
          </button>
        </section>
      ) : !ready ? (
        <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
          <p className="sr-only" role="status">
            {t("learnWave2.messages.loading")}
          </p>
          <div aria-hidden="true" className="grid content-start gap-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-[84px] animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
            ))}
          </div>
        </div>
      ) : threads.length === 0 ? (
        // The platform's empty state (EmptyState), as an h2 right below the shell's h1.
        <EmptyState
          as="h2"
          title={t("learnWave2.messages.empty")}
          description={t("learnWave2.messages.emptyDetail")}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
          {/* On a phone, either the list or the conversation: with one open, the
              list is hidden and the conversation moves up (before, it sat below
              all the others). The "All conversations" arrow at the top goes
              back to the list. */}
          <nav
            aria-label={t("learnWave2.messages.conversations")}
            className={`${selectedThread ? "hidden lg:grid" : "grid"} content-start gap-2`}
          >
            {threads.map((thread) => {
              const isActive = selectedThread?.key === thread.key;
              const lastFromMe = user ? thread.lastMessage.senderId === user.uid : false;
              return (
                <button
                  key={thread.key}
                  type="button"
                  onClick={() => openThread(thread.courseId)}
                  aria-current={isActive ? "true" : undefined}
                  className={`min-h-11 rounded-md border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-[var(--color-primary)] bg-[rgba(44,82,130,0.06)]"
                      : "fine-rule bg-white hover:border-[var(--color-primary)]"
                  }`}
                >
                  <p className="text-sm font-semibold text-[var(--color-primary)]">
                    {thread.courseTitle}
                  </p>
                  <p className="mt-1 truncate text-xs leading-5 text-[var(--color-ink-soft)]">
                    {lastFromMe ? t("learnWave2.messages.youPrefix") : t("learnWave2.messages.teacherPrefix")}
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
            <section
              aria-label={t("learnWave2.messages.conversation").replace("{course}", () => selectedThread.courseTitle)}
              className="rounded-lg border fine-rule bg-white p-5"
            >
              <div className="border-b fine-rule pb-3">
                <h2 className="text-base font-semibold text-[var(--color-primary)]">
                  {selectedThread.courseTitle}
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                  {t("learnWave2.messages.private")}
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
                        {isMine ? t("learnWave2.messages.you") : t("learnWave2.messages.teacher")} ·{" "}
                        {formatNotificationTime(message.createdAt, t, locale)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink)]">
                        {message.body}
                      </p>
                    </li>
                  );
                })}
              </ul>

              <form onSubmit={handleSend} className="mt-5 grid gap-3">
                <label className="sr-only" htmlFor="student-message-draft">
                  {t("learnWave2.messages.message")}
                </label>
                <textarea
                  id="student-message-draft"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={isSending}
                  maxLength={COURSE_MESSAGE_MAX_CHARS}
                  rows={3}
                  className="field-input min-h-20"
                  placeholder={t("learnWave2.messages.placeholder")}
                />
                {notice ? (
                  <InlineAlert tone="error" className="px-3 py-2 text-xs leading-5">
                    {t(notice)}
                  </InlineAlert>
                ) : null}
                <button
                  type="submit"
                  disabled={isSending || !draft.trim()}
                  className="button-solid inline-flex min-h-11 w-fit items-center gap-2 px-4 py-2.5 text-sm"
                >
                  <Send size={15} aria-hidden="true" />
                  <BusyLabel
                    busy={isSending}
                    idle={t("learnWave2.messages.send")}
                    busyText={t("learnWave2.messages.sending")}
                  />
                </button>
              </form>
            </section>
          ) : (
            // "Pick one on the left" only makes sense with the list beside it.
            <section className="hidden rounded-lg border fine-rule bg-white p-5 text-sm leading-6 text-[var(--color-ink-soft)] lg:block">
              {t("learnWave2.messages.pick")}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
