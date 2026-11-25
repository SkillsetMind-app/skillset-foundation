"use client";

import { CheckCircle2, HelpCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { CommunityItemActions } from "@/components/learn/community-item-actions";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { SkillsetUser } from "@/domain/auth";
import { isAnswered, isInstructor, postKind, toMillis } from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  createCommunityComment,
  setCommunityPostAcceptedAnswer,
} from "@/lib/data/community-posts";
import { isRateLimitError } from "@/lib/data/rate-limit-error";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";

// The question drawer (mockup 5, 11b).
//
// POR QUE ISTO EXISTE
//
// Opening a question switched pages and lost the feed; with no address, it was not
// possible to share or go back. Now the question slides in from the right
// (560px) over the darkened feed; on the phone it rises as a bottom sheet.
// The URL changes (.../community/q/<post>), Esc or the X close it. The
// accepted answer stays in green at the top, the others below, and the reply
// box is fixed at the bottom. The same drawer serves any post.

// Outside the component: useModalFocus re-runs the effect if the function changes.
const focusCommunityHeading = () => document.querySelector<HTMLElement>("[data-community-heading]");

export function CommunityPostDrawer({
  post,
  comments,
  currentUser,
  instructorIds,
  canModerate,
  onClose,
  onHide,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  currentUser: SkillsetUser | null;
  instructorIds: ReadonlySet<string>;
  canModerate: boolean;
  onClose: () => void;
  /** Removes from the screen the post or reply that was just deleted. */
  onHide: (id: string) => void;
}) {
  const { t, locale } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Dictionary key, not text: the language can change with the error on screen.
  const [error, setError] = useState("");

  // It closed because the post was deleted: the button that opened the drawer went away with it,
  // and focus goes to the list title.
  useModalFocus(panelRef, true, focusCommunityHeading);

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
      setError("learn.community.drawer.markError");
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    const next = body.trim();
    if (next.length < 3) {
      setError("learn.community.card.shortReply");
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
    } catch (failure) {
      setError(isRateLimitError(failure) ? "learn.community.rateLimit" : "learn.community.card.replyError");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="community-drawer-backdrop" onClick={onClose} data-testid="drawer-backdrop">
      {/* tabIndex -1: useModalFocus poe o foco no proprio painel ao abrir;
          without it focus stayed on the feed card, behind the drawer. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={post.title ?? post.body.slice(0, 60)}
        tabIndex={-1}
        className="community-drawer outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Only one way to close, the X (and Esc), like the other drawers. The
            "Back to feed" beside it did the same thing. */}
        <header className="flex items-center justify-end gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("learn.community.drawer.close")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-soft)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="community-drawer__body">
          <p className="text-xs text-[var(--color-ink-muted)]">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{post.authorName}</span>
            {isInstructor(post, instructorIds) ? ` · ${t("learn.community.card.instructor")}` : ""}
            {" · "}
            {formatNotificationTime(post.createdAt, t, locale)}
            {post.lessonTitle
              ? ` · ${t("learn.community.card.fromLesson").replace("{lesson}", () => post.lessonTitle ?? "")}`
              : ""}
          </p>
          {kind === "question" ? (
            <span
              className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                answered
                  ? "bg-[var(--color-success-soft)] text-[var(--color-success-fg)]"
                  : "bg-[var(--color-surface-soft)] text-[var(--color-ink-soft)]"
              }`}
            >
              {answered ? <CheckCircle2 size={12} aria-hidden /> : <HelpCircle size={12} aria-hidden />}
              {t(answered ? "learn.community.card.answered" : "learn.community.card.question")}
            </span>
          ) : null}
          {post.title ? (
            <h2 className="mt-2 text-lg font-bold leading-7 text-[var(--color-ink)]">{post.title}</h2>
          ) : null}
          {post.body ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-soft)]">{post.body}</p>
          ) : null}
          {/* Pin, delete and report AFTER the text: between the author and the
              title, the actions row was the first thing read in the question. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 empty:hidden">
            <CommunityItemActions
              post={post}
              currentUser={currentUser}
              canModerate={canModerate}
              onDeleted={() => {
                onHide(post.id);
                onClose();
              }}
            />
          </div>

          <ul className="mt-5 grid gap-2" aria-label={t("learn.community.drawer.replies")}>
            {ordered.length === 0 ? (
              <li className="text-sm text-[var(--color-ink-soft)]">{t("learn.community.drawer.noReplies")}</li>
            ) : (
              ordered.map((reply) => {
                const isAnswer = reply.id === accepted?.id;
                return (
                  <li
                    key={reply.id}
                    data-community-item
                    className={`rounded-lg p-3 text-sm ${
                      isAnswer
                        ? "border border-[var(--color-success)] bg-[var(--color-success-soft)]"
                        : "bg-[var(--color-surface-soft)]"
                    }`}
                  >
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      <span className="font-semibold text-[var(--color-ink)]">{reply.authorName}</span>
                      {isInstructor(reply, instructorIds) ? ` · ${t("learn.community.card.instructor")}` : ""}
                      {isAnswer ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 font-bold text-[var(--color-success-fg)]">
                          <CheckCircle2 size={11} aria-hidden /> {t("learn.community.card.answer")}
                        </span>
                      ) : null}
                      {" · "}
                      {formatNotificationTime(reply.createdAt, t, locale)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-[var(--color-ink)]">{reply.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {canMark ? (
                        <button
                          type="button"
                          onClick={() => void markAnswer(isAnswer ? null : reply.id)}
                          className="min-h-11 text-xs font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          {t(isAnswer ? "learn.community.drawer.unmark" : "learn.community.drawer.mark")}
                        </button>
                      ) : null}
                      <CommunityItemActions
                        post={post}
                        comment={reply}
                        currentUser={currentUser}
                        canModerate={canModerate}
                        onDeleted={() => onHide(reply.id)}
                      />
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {currentUser ? (
          <form onSubmit={submitReply} className="community-drawer__reply">
            <label className="flex-1">
              <span className="sr-only">{t("learn.community.drawer.replyLabel")}</span>
              <input
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t("learn.community.drawer.replyPlaceholder")}
                className="field-input min-h-11 w-full"
              />
            </label>
            <button
              type="submit"
              disabled={isSending}
              className="button-solid min-h-11 px-4 text-sm"
            >
              <BusyLabel
                busy={isSending}
                idle={t("learn.community.drawer.send")}
                busyText={t("learn.community.drawer.sending")}
              />
            </button>
            {error ? (
              <InlineAlert tone="error" className="basis-full px-3 py-2 text-xs leading-5">
                {t(error)}
              </InlineAlert>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}
