"use client";

import { MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui";
import { loadTeacherInbox } from "@/components/teacher/use-teacher-inbox-count";
import type { CommunityPost } from "@/domain/community-post";
import { getCommunityPostsByIds } from "@/lib/data/community-posts";

type Question = { post: CommunityPost; courseTitle: string };
type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; questions: Question[] };

// A metade "comunidade" da Caixa de entrada: as perguntas que esperam pelo
// professor em todos os produtos com comunidade ligada. A resposta continua
// sendo dada na caixa de cada curso (/teach/courses/<id>/community), que ja
// marca a resposta aceita; aqui so se ve o que falta e se chega la com um
// clique. A caixa do curso nao tem endereco por pergunta (la as que esperam
// ficam no topo), entao "Answer" leva para a caixa do curso.
//
// A lista de quem espera vem da MESMA leitura do numero da barra
// (loadTeacherInbox); o texto das perguntas so e lido aqui.
export function TeacherInboxQuestions() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  // "Try again" pede a mesma leitura de novo.
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) {
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const inbox = await loadTeacherInbox(uid);
        const titles = new Map(inbox.courses.map((course) => [course.id, course.title]));
        const posts = await getCommunityPostsByIds(inbox.questions);
        if (alive) {
          setState({
            status: "ready",
            questions: posts.map((post) => ({ post, courseTitle: titles.get(post.courseSlug) ?? "" })),
          });
        }
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid, attempt]);

  const count = state.status === "ready" ? state.questions.length : null;

  return (
    <section
      aria-labelledby="inbox-questions-title"
      className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
    >
      <h2 id="inbox-questions-title" className="flex items-center gap-2 text-lg font-semibold text-[var(--color-ink)]">
        {t("teach.inboxPage.questionsTitle")}
        {count !== null ? (
          <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-[var(--color-primary)] px-2 text-xs font-bold text-[var(--color-base)]">
            {new Intl.NumberFormat(locale).format(count)}
          </span>
        ) : null}
      </h2>

      {/* Enquanto le, o cartao mostra a forma das linhas (antes ficava so o
          titulo, sem numero nem frase, ate a lista pular para dentro). */}
      {state.status === "loading" ? (
        <div aria-busy="true" className="mt-3 grid gap-2">
          <p role="status" className="sr-only">
            {t("teach.inboxPage.questionsLoading")}
          </p>
          {[0, 1].map((row) => (
            <div key={row} aria-hidden="true" className="h-16 animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <div className="mt-3 grid gap-3">
          <InlineAlert tone="error">{t("teach.inboxPage.questionsError")}</InlineAlert>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((current) => current + 1);
            }}
            className="button-outline justify-self-start px-4 text-sm"
          >
            {t("appErrors.retry")}
          </button>
        </div>
      ) : state.questions.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("teach.inboxPage.questionsEmpty")}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {state.questions.map(({ post, courseTitle }) => (
            <li
              key={post.id}
              className="flex flex-wrap items-center gap-3 rounded-md border fine-rule bg-[var(--color-surface-soft)] p-3"
            >
              <MessageCircleQuestion aria-hidden="true" size={18} className="shrink-0 text-[var(--color-primary)]" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold text-[var(--color-ink)]">
                  {post.title ?? post.body}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                  {[courseTitle, post.authorName, formatNotificationTime(post.createdAt, t, locale)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Link
                href={`/teach/courses/${encodeURIComponent(post.courseSlug)}/community`}
                // Contorno: dez perguntas eram dez botoes fortes na mesma tela.
                className="button-outline min-h-11 px-4 text-sm"
              >
                {t("teach.inboxPage.answer")}
                <span className="sr-only">: {(post.title ?? post.body).slice(0, 80)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
