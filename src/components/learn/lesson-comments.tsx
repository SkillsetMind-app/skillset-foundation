"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { filterPosts, groupCommentsByPost } from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { Course } from "@/domain/learning";
import {
  createCommunityPost,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";
import { isRateLimitError } from "@/lib/data/rate-limit-error";

// Lesson comments under the player (Hotmart parity, §4.3 / P3).
//
// WHY THIS EXISTS
//
// The course conversation lives in the Community tab, far from the video. The feed
// already links a question to a lesson (lesson_id), so the list here is the SAME data as the feed —
// the same functions from src/lib/data/community-posts.ts, the same channel per
// course (community_posts:course:<id>), filtered by the open lesson. Posting is
// the same path as a question with a lesson attached (category question + lessonId
// + "lesson N"): no new table, RPC or migration, and the question shows up
// in the Community tab like any other. No likes or replies here —
// those stay in the feed ("View in community" opens the post in the drawer).
//
// ponytail: the channel is per course, one at a time — the lesson tab and the
// Community tab are never mounted together, and switching lessons only changes the filter.
// New posts come in right away (the feed holds other people's posts behind the
// "N new posts" pill); if the list under the player gets noisy, the upgrade is
// to reuse the pill.

type LessonCommentsProps = {
  course: Course;
  /** The open lesson: id to filter by, number for the feed's "lesson N". */
  lesson: { id: string; number: number };
  /** "/learn/courses/<course>" — "View in community" is built from here. */
  basePath: string;
  previewMode: boolean;
};

export function LessonComments({ course, lesson, basePath, previewMode }: LessonCommentsProps) {
  // Community turned off for the course: the whole section disappears (no disabled
  // box pointing to a tab that does not exist).
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
  // Teacher preview and a visitor with no session: the same gate as the feed
  // (enrollment), without opening any subscription.
  const canRead = !previewMode && Boolean(user);
  const [feed, setFeed] = useState<{ posts: CommunityPost[]; ready: boolean }>({
    posts: [],
    ready: false,
  });
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Dictionary key, not text: the language can change while the error is on the screen.
  const [error, setError] = useState("");
  // The read failure is kept apart from the form error: it has "Try again", which
  // rereads through the same channel; the notice only goes away when the comments arrive, and the
  // ones already on the screen stay. Focus goes to the section (the button disappears).
  const [postsFailed, setPostsFailed] = useState(false);
  // The screen reader hears only the posted comment itself, not the list:
  // in a busy conversation the live list read out every post that arrived.
  const [posted, setPosted] = useState(false);
  const postsSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Posting or cancelling unmounts the text box that had focus, and focus
  // fell to the <body>: it goes back to the box at rest, where the person came from.
  const composerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      composerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    const current = subscribeToCommunityPosts(
      courseSlug,
      (posts) => {
        setFeed({ posts, ready: true });
        setPostsFailed(false);
      },
      () => setPostsFailed(true),
    );
    postsSubscription.current = current;
    return () => {
      postsSubscription.current = null;
      current();
    };
  }, [canRead, courseSlug]);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    return subscribeToCourseCommunityComments(courseSlug, setComments, () => undefined);
  }, [canRead, courseSlug]);

  // The same order as the feed (pinned first, then from newest to
  // oldest) — filterPosts is what the Community tab uses.
  const lessonPosts = useMemo(
    () => filterPosts(feed.posts.filter((post) => post.lessonId === lesson.id), "all"),
    [feed.posts, lesson.id],
  );
  const commentsByPost = useMemo(() => groupCommentsByPost(comments), [comments]);

  function cancel() {
    returnFocus.current = true;
    setOpen(false);
    setBody("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      return;
    }
    // First line = the question (the feed title); the rest = details.
    const [firstLine = "", ...rest] = body.trim().split("\n");
    const title = firstLine.trim();
    const details = rest.join("\n").trim();
    if (title.length < 8) {
      setError("learn.community.composer.shortQuestion");
      return;
    }
    setError("");
    setPosted(false);
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
      returnFocus.current = true;
      setOpen(false);
      setPosted(true);
    } catch (failure) {
      setError(isRateLimitError(failure) ? "learn.community.rateLimit" : "learn.community.composer.publishError");
    } finally {
      setIsSubmitting(false);
    }
  }

  const count = canRead && feed.ready ? lessonPosts.length : null;

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="member-lesson-comments-title"
      className="member-lesson-comments rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
    >
      <div className="flex items-center gap-2">
        <MessageCircle size={15} className="text-[var(--color-accent-fg)]" aria-hidden />
        {/* h3: lesson subsection (the lesson title is the panel's h2). */}
        <h3 id="member-lesson-comments-title" className="text-sm font-bold text-[var(--color-ink)]">
          {t("learn.classroom.lessonComments.title")}
          {count == null ? "" : ` · ${count}`}
        </h3>
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
              className="field-input resize-y"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={cancel} className="button-outline min-h-11 px-4 text-sm">
              {t("learn.community.composer.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="button-solid min-h-11 px-4 text-sm"
            >
              <BusyLabel
                busy={isSubmitting}
                idle={t("learn.classroom.lessonComments.publish")}
                busyText={t("learn.community.composer.posting")}
              />
            </button>
          </div>
        </form>
      ) : (
        // The "box" at rest is a button that looks like a field (the same design
        // as the feed composer): it only becomes a textarea on click. Disabled
        // in preview and with no session, showing the feed gate's message.
        <button
          ref={composerRef}
          type="button"
          disabled={!canRead}
          onClick={() => setOpen(true)}
          className="mt-3 flex min-h-11 w-full items-center rounded-md border border-[var(--color-line)] bg-white px-4 text-left text-sm text-[var(--color-ink-soft)] disabled:opacity-60"
        >
          {t(canRead ? "learn.classroom.lessonComments.prompt" : "learn.community.gateHeading")}
        </button>
      )}

      {postsFailed && canRead ? (
        <LoadErrorAlert className="mt-3" focusRef={sectionRef} onRetry={() => postsSubscription.current?.reload()}>
          {t("learn.community.postsError")}
        </LoadErrorAlert>
      ) : null}

      {error ? (
        <InlineAlert tone="error" className="mt-3 px-3 py-2">
          {t(error)}
        </InlineAlert>
      ) : null}

      {canRead ? (
        <div className="mt-3 grid gap-2">
          {/* Only "posted" when the comment itself goes in. There is only one "loading",
              the one from the lesson panel (F-02): the stage and these comments
              used to announce at the same time. */}
          <p role="status" className="sr-only">
            {posted ? t("learn.classroom.lessonComments.posted") : ""}
          </p>
          {/* With the read in error, neither "loading" nor the empty state: only the notice. */}
          {!feed.ready || (postsFailed && lessonPosts.length === 0) ? (
            postsFailed ? null : (
              // Waiting: a line shaped like the comment (avatar and two
              // lines), in place of the "Loading lesson comments..." text.
              <div aria-hidden="true" className="flex gap-3 rounded-md border border-[var(--color-line)] bg-white p-3">
                <span className="h-8 w-8 shrink-0 rounded-full bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse" />
                <span className="grid flex-1 content-center gap-2">
                  <span className="block h-3 w-1/3 rounded-sm bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse" />
                  <span className="block h-3 w-4/5 rounded-sm bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse" />
                </span>
              </div>
            )
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
                    className="flex gap-3 rounded-md border border-[var(--color-line)] bg-white p-3"
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
                          className="inline-flex min-h-11 items-center rounded-md px-2 text-[var(--color-ink)] underline-offset-4 hover:underline"
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
