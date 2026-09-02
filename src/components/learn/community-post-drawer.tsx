"use client";

import { ArrowLeft, CheckCircle2, HelpCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import type { SkillsetUser } from "@/domain/auth";
import { isAnswered, isInstructor, postKind, toMillis } from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  createCommunityComment,
  setCommunityPostAcceptedAnswer,
} from "@/lib/data/community-posts";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";

// A gaveta da pergunta (mockup 5, 11b).
//
// POR QUE ISTO EXISTE
//
// Abrir uma pergunta trocava de pagina e perdia o feed; sem endereco, nao
// dava para compartilhar nem voltar. Agora a pergunta desliza da direita
// (560px) por cima do feed escurecido; no celular sobe como folha inferior.
// A URL muda (.../community/q/<post>), Esc ou "Back to feed" fecham. A
// resposta aceita fica em verde no topo, as demais embaixo, e a caixa de
// resposta e fixa no rodape. A mesma gaveta serve para qualquer post.

export function CommunityPostDrawer({
  post,
  comments,
  currentUser,
  instructorIds,
  canModerate,
  onClose,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  currentUser: SkillsetUser | null;
  instructorIds: ReadonlySet<string>;
  canModerate: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  useModalFocus(panelRef, true);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const kind = postKind(post);
  const answered = isAnswered(post);
  const canMark =
    kind === "question" && Boolean(currentUser) && (currentUser?.uid === post.authorId || canModerate);
  const accepted = post.acceptedCommentId
    ? comments.find((comment) => comment.id === post.acceptedCommentId) ?? null
    : null;
  const others = comments
    .filter((comment) => comment.id !== accepted?.id)
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  const ordered = accepted ? [accepted, ...others] : others;

  async function markAnswer(commentId: string | null) {
    setError("");
    try {
      await setCommunityPostAcceptedAnswer(post.id, commentId);
    } catch {
      setError("We could not save the answer mark. Try again.");
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    const next = body.trim();
    if (next.length < 3) {
      setError("Write a short reply first.");
      return;
    }
    setError("");
    setIsSending(true);
    try {
      await createCommunityComment({
        postId: post.id,
        courseSlug: post.courseSlug,
        body: next,
        user: currentUser,
      });
      setBody("");
    } catch {
      setError("We could not publish your reply.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="community-drawer-backdrop" onClick={onClose} data-testid="drawer-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={post.title ?? post.body.slice(0, 60)}
        className="community-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-primary)]"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to feed
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-soft)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="community-drawer__body">
          <p className="text-xs text-[var(--color-ink-muted)]">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{post.authorName}</span>
            {isInstructor(post, instructorIds) ? " · Instructor" : ""}
            {" · "}
            {formatNotificationTime(post.createdAt)}
            {post.lessonTitle ? ` · from ${post.lessonTitle}` : ""}
          </p>
          {kind === "question" ? (
            <span
              className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                answered
                  ? "bg-[rgba(22,163,74,0.1)] text-[rgb(21,128,61)]"
                  : "bg-[var(--color-surface-soft)] text-[var(--color-ink-soft)]"
              }`}
            >
              {answered ? <CheckCircle2 size={12} aria-hidden /> : <HelpCircle size={12} aria-hidden />}
              {answered ? "Answered" : "Question"}
            </span>
          ) : null}
          {post.title ? (
            <h2 className="mt-2 text-lg font-bold leading-7 text-[var(--color-ink)]">{post.title}</h2>
          ) : null}
          {post.body ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-soft)]">{post.body}</p>
          ) : null}

          <ul className="mt-5 grid gap-2" aria-label="Replies">
            {ordered.length === 0 ? (
              <li className="text-sm text-[var(--color-ink-soft)]">No replies yet. Be the first.</li>
            ) : (
              ordered.map((reply) => {
                const isAnswer = reply.id === accepted?.id;
                return (
                  <li
                    key={reply.id}
                    className={`rounded-[12px] p-3 text-sm ${
                      isAnswer
                        ? "border border-[rgba(22,163,74,0.35)] bg-[rgba(22,163,74,0.08)]"
                        : "bg-[var(--color-surface-soft)]"
                    }`}
                  >
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      <span className="font-semibold text-[var(--color-ink)]">{reply.authorName}</span>
                      {isInstructor(reply, instructorIds) ? " · Instructor" : ""}
                      {isAnswer ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 font-bold text-[rgb(21,128,61)]">
                          <CheckCircle2 size={11} aria-hidden /> answer
                        </span>
                      ) : null}
                      {" · "}
                      {formatNotificationTime(reply.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-[var(--color-ink)]">{reply.body}</p>
                    {canMark ? (
                      <button
                        type="button"
                        onClick={() => void markAnswer(isAnswer ? null : reply.id)}
                        className="mt-2 min-h-9 text-xs font-semibold text-[var(--color-primary)] hover:underline"
                      >
                        {isAnswer ? "Unmark as the answer" : "Mark as the answer"}
                      </button>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {currentUser ? (
          <form onSubmit={submitReply} className="community-drawer__reply">
            <label className="flex-1">
              <span className="sr-only">Add your reply</span>
              <input
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Add your reply…"
                className="field-input min-h-11 w-full"
              />
            </label>
            <button
              type="submit"
              disabled={isSending}
              className="button-solid min-h-11 px-4 text-sm disabled:opacity-60"
            >
              {isSending ? "…" : "Reply"}
            </button>
            {error ? (
              <p role="alert" className="basis-full text-xs font-semibold text-[var(--color-danger-fg)]">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}
