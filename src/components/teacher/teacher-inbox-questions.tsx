"use client";

import { MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui";
import type { CommunityPost } from "@/domain/community-post";
import { getOpenCommunityQuestions } from "@/lib/data/community-posts";
import { getMyCourseSummaries } from "@/lib/data/teacher-courses";

type Question = { post: CommunityPost; courseTitle: string };
type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; questions: Question[] };

// A metade "comunidade" da Caixa de entrada: as perguntas que esperam pelo
// professor em todos os produtos. A resposta continua sendo dada na caixa de
// cada curso (/teach/courses/<id>/community), que ja marca a resposta aceita;
// aqui so se ve o que falta e se chega la com um clique.
export function TeacherInboxQuestions() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) {
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const courses = await getMyCourseSummaries(uid);
        const titles = new Map(courses.map((course) => [course.id, course.title]));
        const posts = await getOpenCommunityQuestions(courses.map((course) => course.id), uid);
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
  }, [uid]);

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

      {state.status === "error" ? (
        <InlineAlert tone="error" className="mt-3">
          {t("teach.inboxPage.questionsError")}
        </InlineAlert>
      ) : state.status === "ready" && state.questions.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("teach.inboxPage.questionsEmpty")}
        </p>
      ) : state.status === "ready" ? (
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
                className="button-solid min-h-11 px-4 text-sm"
              >
                {t("teach.inboxPage.answer")}
                <span className="sr-only">: {(post.title ?? post.body).slice(0, 80)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
