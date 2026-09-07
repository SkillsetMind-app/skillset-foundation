"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { filterPosts, groupCommentsByPost } from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { Course } from "@/domain/learning";
import {
  createCommunityPost,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";

// Comentarios da aula sob o player (paridade Hotmart, §4.3 / P3).
//
// POR QUE ISTO EXISTE
//
// A conversa do curso mora na aba Community, longe do video. O feed ja liga
// pergunta a aula (lesson_id), entao a lista daqui e o MESMO dado do feed —
// as mesmas funcoes de src/lib/data/community-posts.ts, o mesmo canal por
// curso (community_posts:course:<id>), filtrado pela aula aberta. Publicar e
// o mesmo caminho da pergunta com aula anexada (category question + lessonId
// + "lesson N"): nenhuma tabela, RPC ou migration nova, e a pergunta aparece
// na aba Community como qualquer outra. Sem curtidas nem respostas aqui —
// isso segue no feed ("Ver na comunidade" abre o post na gaveta).
//
// ponytail: o canal e por curso, um de cada vez — a aba da aula e a aba
// Community nunca estao montadas juntas, e trocar de aula so troca o filtro.
// Posts novos entram na hora (o feed guarda os de outras pessoas atras da
// pilula "N new posts"); se a lista sob o player virar ruido, o upgrade e
// reaproveitar a pilula.

type LessonCommentsProps = {
  course: Course;
  /** A aula aberta: id para filtrar, numero para o "lesson N" do feed. */
  lesson: { id: string; number: number };
  /** "/learn/courses/<curso>" — "Ver na comunidade" nasce daqui. */
  basePath: string;
  previewMode: boolean;
};

export function LessonComments({ course, lesson, basePath, previewMode }: LessonCommentsProps) {
  // Comunidade desligada no curso: a secao inteira some (nada de caixa
  // desabilitada apontando para uma aba que nao existe).
  if (!course.communityEnabled) {
    return null;
  }
  return (
    <LessonCommentsPanel
      courseSlug={course.id}
      lesson={lesson}
      basePath={basePath}
      previewMode={previewMode}
    />
  );
}

function LessonCommentsPanel({
  courseSlug,
  lesson,
  basePath,
  previewMode,
}: Omit<LessonCommentsProps, "course"> & { courseSlug: string }) {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  // Preview do professor e visitante sem sessao: mesma porta do feed
  // (matricula), sem abrir inscricao nenhuma.
  const canRead = !previewMode && Boolean(user);
  const [feed, setFeed] = useState<{ posts: CommunityPost[]; ready: boolean }>({
    posts: [],
    ready: false,
  });
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Chave do dicionario, nao texto: o idioma pode trocar com o erro na tela.
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canRead) {
      return;
    }
    return subscribeToCommunityPosts(
      courseSlug,
      (posts) => setFeed({ posts, ready: true }),
      () => {
        setError("learn.community.postsError");
        setFeed({ posts: [], ready: true });
      },
    );
  }, [canRead, courseSlug]);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    return subscribeToCourseCommunityComments(courseSlug, setComments, () => undefined);
  }, [canRead, courseSlug]);

  // A mesma ordem do feed (fixados primeiro, depois do mais novo ao mais
  // antigo) — filterPosts e o que a aba Community usa.
  const lessonPosts = useMemo(
    () => filterPosts(feed.posts.filter((post) => post.lessonId === lesson.id), "all"),
    [feed.posts, lesson.id],
  );
  const commentsByPost = useMemo(() => groupCommentsByPost(comments), [comments]);

  function cancel() {
    setOpen(false);
    setBody("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      return;
    }
    // Primeira linha = a pergunta (o titulo do feed); o resto = detalhes.
    const [firstLine = "", ...rest] = body.trim().split("\n");
    const title = firstLine.trim();
    const details = rest.join("\n").trim();
    if (title.length < 8) {
      setError("learn.community.composer.shortQuestion");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      await createCommunityPost({
        courseSlug,
        category: "question",
        title,
        body: details,
        lessonId: lesson.id,
        lessonTitle: `lesson ${lesson.number}`,
        user,
      });
      setBody("");
      setOpen(false);
    } catch {
      setError("learn.community.composer.publishError");
    } finally {
      setIsSubmitting(false);
    }
  }

  const count = canRead && feed.ready ? lessonPosts.length : null;

  return (
    <section
      aria-labelledby="member-lesson-comments-title"
      className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
    >
      <div className="flex items-center gap-2">
        <MessageCircle size={15} className="text-[var(--color-accent-fg)]" aria-hidden />
        <h5 id="member-lesson-comments-title" className="text-sm font-bold text-[var(--color-ink)]">
          {t("learn.classroom.lessonComments.title")}
          {count == null ? "" : ` · ${count}`}
        </h5>
      </div>

      {open && canRead ? (
        <form
          onSubmit={handleSubmit}
          aria-label={t("learn.classroom.lessonComments.form")}
          className="mt-3 grid gap-2"
        >
          <label className="grid gap-1 text-sm">
            <span className="sr-only">{t("learn.classroom.lessonComments.bodyLabel")}</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              autoFocus
              placeholder={t("learn.classroom.lessonComments.prompt")}
              className="resize-y rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm text-[var(--color-ink)]"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={cancel} className="button-outline min-h-11 px-4 text-sm">
              {t("learn.community.composer.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="button-solid min-h-11 px-4 text-sm disabled:opacity-60"
            >
              {t(
                isSubmitting
                  ? "learn.community.composer.posting"
                  : "learn.classroom.lessonComments.publish",
              )}
            </button>
          </div>
        </form>
      ) : (
        // A "caixa" em repouso e um botao com cara de campo (o mesmo desenho
        // do compositor do feed): so vira textarea ao clicar. Desabilitada
        // no preview e sem sessao, com a mensagem da porta do feed.
        <button
          type="button"
          disabled={!canRead}
          onClick={() => setOpen(true)}
          className="mt-3 flex min-h-11 w-full items-center rounded-[10px] border border-[var(--color-line)] bg-white px-4 text-left text-sm text-[var(--color-ink-soft)] disabled:opacity-70"
        >
          {t(canRead ? "learn.classroom.lessonComments.prompt" : "learn.community.gateHeading")}
        </button>
      )}

      {error ? (
        <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      ) : null}

      {canRead ? (
        <div className="mt-3 grid gap-2" aria-live="polite">
          {!feed.ready ? (
            <p className="text-sm text-[var(--color-ink-soft)]">
              {t("learn.classroom.lessonComments.loading")}
            </p>
          ) : lessonPosts.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-soft)]">
              {t("learn.classroom.lessonComments.empty")}
            </p>
          ) : (
            <ul className="grid gap-2">
              {lessonPosts.map((post) => {
                const replies = commentsByPost.get(post.id)?.length ?? 0;
                return (
                  <li
                    key={post.id}
                    className="flex gap-3 rounded-[10px] border border-[var(--color-line)] bg-white p-3"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-[var(--color-base)]"
                    >
                      {initials(post.authorName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        <span className="text-sm font-semibold text-[var(--color-ink)]">
                          {post.authorName}
                        </span>
                        {" · "}
                        {formatNotificationTime(post.createdAt, t, locale)}
                      </p>
                      {post.title ? (
                        <p className="mt-1 text-sm font-semibold leading-6 text-[var(--color-ink)]">
                          {post.title}
                        </p>
                      ) : null}
                      {post.body ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-soft)]">
                          {post.body}
                        </p>
                      ) : null}
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-[var(--color-ink-soft)]">
                        <span>
                          {t(
                            `learn.classroom.lessonComments.${replies === 1 ? "replyOne" : "replyMany"}`,
                          ).replace("{count}", () => String(replies))}
                        </span>
                        <Link
                          href={`${basePath}/community/q/${encodeURIComponent(post.id)}?lesson=${encodeURIComponent(lesson.id)}`}
                          className="inline-flex min-h-11 items-center rounded-[8px] px-2 text-[var(--color-ink)] underline-offset-4 hover:underline"
                        >
                          {t("learn.classroom.lessonComments.viewInCommunity")}
                        </Link>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
