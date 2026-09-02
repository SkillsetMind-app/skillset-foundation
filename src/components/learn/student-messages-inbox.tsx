"use client";

import { ArrowLeft, Inbox, Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { formatNotificationTime } from "@/components/account/notification-row";
import type { CourseMessage } from "@/domain/course-message";
import {
  COURSE_MESSAGE_MAX_CHARS,
  groupCourseMessageThreads,
} from "@/domain/course-message";
import {
  sendCourseMessage,
  subscribeToStudentMessages,
} from "@/lib/data/course-messages";

// A caixa de mensagens do aluno (/learn/messages).
//
// POR QUE ISTO EXISTE
//
// Para responder ao professor era preciso rolar quatro ou cinco telas ate o
// fim da pagina da aula, depois da comunidade. Com tres cursos, tres lugares.
// O aluno nao tinha uma lista de conversas; o professor tinha
// (teacher-messages-inbox.tsx, o molde deste arquivo). Uma conversa por curso;
// a conversa aberta vai no endereco (?course=) — compartilhar abre a mesma,
// e o voltar do navegador devolve a lista.
export function StudentMessagesInbox() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/learn/messages";
  const searchParams = useSearchParams();
  const courseParam = searchParams?.get("course") ?? null;

  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToStudentMessages(user.uid, setMessages, () => {
      setNotice("We could not load your messages.");
    });
  }, [user]);

  // Para o aluno, cada thread e um curso (a chave e curso + o proprio aluno).
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

  // Voltar e sempre a seta no canto superior esquerdo, um nivel acima:
  // conversa -> lista -> painel.
  const backHref = selectedThread ? pathname : "/learn";
  const backLabel = selectedThread ? "All conversations" : "Back";

  return (
    <div className="grid gap-5">
      <Link
        href={backHref}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-[var(--color-primary)]"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {backLabel}
      </Link>

      {threads.length === 0 ? (
        <section className="rounded-[16px] border fine-rule bg-white px-6 py-10 text-center">
          <Inbox
            aria-hidden="true"
            className="mx-auto text-[var(--color-ink-muted)]"
            size={28}
          />
          <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
            No conversations yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
            Write to a teacher from the Messages tab inside any of your courses.
            The thread appears here, and replies land in your notification bell.
          </p>
          {notice ? (
            <p className="mt-4 text-xs font-semibold text-[var(--color-primary)]">
              {notice}
            </p>
          ) : null}
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
          <nav aria-label="Conversations" className="grid content-start gap-2">
            {threads.map((thread) => {
              const isActive = selectedThread?.key === thread.key;
              const lastFromMe = user ? thread.lastMessage.senderId === user.uid : false;
              return (
                <button
                  key={thread.key}
                  type="button"
                  onClick={() => openThread(thread.courseId)}
                  aria-current={isActive ? "true" : undefined}
                  className={`min-h-11 rounded-[12px] border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-[var(--color-primary)] bg-[rgba(44,82,130,0.06)]"
                      : "fine-rule bg-white hover:border-[var(--color-primary)]"
                  }`}
                >
                  <p className="text-sm font-semibold text-[var(--color-primary)]">
                    {thread.courseTitle}
                  </p>
                  <p className="mt-1 truncate text-xs leading-5 text-[var(--color-ink-soft)]">
                    {lastFromMe ? "You: " : "Teacher: "}
                    {thread.lastMessage.body}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-[var(--color-ink-muted)]">
                    {formatNotificationTime(thread.lastMessage.createdAt)}
                  </p>
                </button>
              );
            })}
          </nav>

          {selectedThread ? (
            <section
              aria-label={`Conversation: ${selectedThread.courseTitle}`}
              className="rounded-[16px] border fine-rule bg-white p-5"
            >
              <div className="border-b fine-rule pb-3">
                <h2 className="text-base font-semibold text-[var(--color-primary)]">
                  {selectedThread.courseTitle}
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                  Private thread with the course teacher
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

              <form onSubmit={handleSend} className="mt-5 grid gap-3">
                <label className="sr-only" htmlFor="student-message-draft">
                  Your message
                </label>
                <textarea
                  id="student-message-draft"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={isSending}
                  maxLength={COURSE_MESSAGE_MAX_CHARS}
                  rows={3}
                  className="min-h-20 rounded-[12px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
                  placeholder="Write to your teacher..."
                />
                {notice ? (
                  <p className="rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-primary)]">
                    {notice}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={isSending || !draft.trim()}
                  className="button-solid inline-flex min-h-11 w-fit items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  <Send size={15} aria-hidden="true" />
                  {isSending ? "Sending..." : "Send"}
                </button>
              </form>
            </section>
          ) : (
            <section className="rounded-[16px] border fine-rule bg-white p-5 text-sm leading-6 text-[var(--color-ink-soft)]">
              Pick a course on the left to read the conversation.
            </section>
          )}
        </div>
      )}
    </div>
  );
}
