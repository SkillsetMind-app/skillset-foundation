"use client";

import { ArrowLeft, Inbox, Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { formatNotificationTime } from "@/components/account/notification-row";
import { useTranslation } from "@/components/i18n/i18n-provider";
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
  const { t, locale } = useTranslation();
  const router = useRouter();
  const pathname = usePathname() ?? "/learn/messages";
  const searchParams = useSearchParams();
  const courseParam = searchParams?.get("course") ?? null;

  const [messages, setMessages] = useState<CourseMessage[]>([]);
  // Até a primeira leitura chegar a lista está "carregando", não "vazia":
  // antes toda visita mostrava "No conversations yet" e depois trocava pelas
  // conversas. Se a primeira leitura falha, o erro com "Try again" fica no
  // lugar do vazio (uma falha não é "você não tem conversas").
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    let loaded = false;
    return subscribeToStudentMessages(
      user.uid,
      (next) => {
        loaded = true;
        setMessages(next);
        setReady(true);
      },
      () => {
        // Falha numa releitura (o canal em tempo real recarrega) não apaga a
        // lista que já está na tela: vira só o aviso.
        if (loaded) {
          setNotice("learnWave2.messages.loadError");
        } else {
          setLoadFailed(true);
        }
      },
    );
  }, [user, attempt]);

  function retryLoad() {
    setLoadFailed(false);
    setAttempt((current) => current + 1);
  }

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
    } catch {
      setNotice("learnWave2.messages.sendError");
    } finally {
      setIsSending(false);
    }
  }

  // Voltar e sempre a seta no canto superior esquerdo, um nivel acima:
  // conversa -> lista -> painel.
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
              <div key={row} className="h-[84px] animate-pulse rounded-md bg-[var(--color-surface-soft)]" />
            ))}
          </div>
        </div>
      ) : threads.length === 0 ? (
        <section className="rounded-lg border fine-rule bg-white px-6 py-10 text-center">
          <Inbox
            aria-hidden="true"
            className="mx-auto text-[var(--color-ink-muted)]"
            size={28}
          />
          <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
            {t("learnWave2.messages.empty")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("learnWave2.messages.emptyDetail")}
          </p>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
          {/* No celular a lista ou a conversa: com uma aberta, a lista sai e a
              conversa sobe (antes ela ficava embaixo de todas as outras). A
              seta "All conversations" lá em cima volta para a lista. */}
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
                  className="min-h-20 rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
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
                  className="button-solid inline-flex min-h-11 w-fit items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  <Send size={15} aria-hidden="true" />
                  {isSending ? t("learnWave2.messages.sending") : t("learnWave2.messages.send")}
                </button>
              </form>
            </section>
          ) : (
            // "Escolha à esquerda" só faz sentido com a lista ao lado.
            <section className="hidden rounded-lg border fine-rule bg-white p-5 text-sm leading-6 text-[var(--color-ink-soft)] lg:block">
              {t("learnWave2.messages.pick")}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
