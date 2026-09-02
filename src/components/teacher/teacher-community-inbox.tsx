"use client";

import { ArrowLeft, CheckCircle2, Pin } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import {
  groupCommentsByPost,
  isInstructor,
  openQuestions,
  toMillis,
  waitingFor,
  weekSummary,
} from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  createCommunityComment,
  createCommunityPost,
  setCommunityPostAcceptedAnswer,
  setCommunityPostPinned,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";

// A comunidade, vista pelo professor (mockup 5, 11d).
//
// POR QUE ISTO EXISTE
//
// O professor nao tinha tela nenhuma da propria comunidade: ou abria a sala
// como se fosse aluno (e nem podia, sem matricula), ou nao via nada. O que
// ele precisa e uma CAIXA DE ENTRADA: "Waiting for an answer · N" no topo,
// com a resposta escrita ali mesmo e ja marcada como A resposta; e o resto em
// cartoes curtos. Espacos, automacoes e moderadores nao existem no sistema —
// entao nao aparecem aqui fingindo existir.

export function TeacherCommunityInbox({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [courseReady, setCourseReady] = useState(false);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    return subscribeToTeacherCourse(
      courseId,
      (next) => {
        setCourse(next);
        setCourseReady(true);
      },
      () => {
        setError("We could not load this course.");
        setCourseReady(true);
      },
    );
  }, [courseId]);

  useEffect(() => {
    if (!course) {
      return;
    }
    return subscribeToCommunityPosts(course.id, setPosts, () => {
      setError("We could not load community posts.");
    });
  }, [course]);

  useEffect(() => {
    if (!course) {
      return;
    }
    return subscribeToCourseCommunityComments(course.id, setComments, () => undefined);
  }, [course]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const instructorIds = useMemo(() => (course ? [course.ownerId] : []), [course]);
  const queue = useMemo(
    () => openQuestions(posts, comments, instructorIds),
    [comments, instructorIds, posts],
  );
  const week = useMemo(() => weekSummary(posts, comments, now), [comments, now, posts]);
  const medianReplyHours = useMemo(
    () => medianInstructorReplyHours(posts, comments, instructorIds),
    [comments, instructorIds, posts],
  );

  if (!courseReady) {
    return <p className="text-sm text-[var(--color-ink-soft)]">Loading community...</p>;
  }

  if (!course || !user) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {error || "Course not found."}
        </p>
      </section>
    );
  }

  const memberCount = course.enrollmentCount ?? null;

  return (
    <div className="grid gap-5">
      <Link
        href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-[var(--color-primary)]"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to {course.title}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Community
          </p>
          <h1 className="display-title mt-1 text-3xl text-[var(--color-ink)]">{course.title}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {memberCount !== null ? `${memberCount} members · ` : ""}
            {week.activeMembers} active this week
            {medianReplyHours !== null ? ` · your median reply ${formatHours(medianReplyHours)}` : ""}
          </p>
        </div>
        <UpdateComposer courseId={course.id} user={user} onError={setError} />
      </header>

      {error ? (
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section aria-labelledby="waiting-heading" className="grid gap-3">
          <h2 id="waiting-heading" className="text-lg font-semibold text-[var(--color-ink)]">
            Waiting for an answer
            <span className="ml-2 inline-flex min-w-7 items-center justify-center rounded-full bg-[var(--color-primary)] px-2 text-xs font-bold text-[var(--color-base)]">
              {queue.length}
            </span>
          </h2>

          {queue.length === 0 ? (
            <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
              Nothing waiting. Every question has an answer.
            </p>
          ) : (
            queue.map((post) => (
              <WaitingCard
                key={post.id}
                post={post}
                replies={groupCommentsByPost(comments).get(post.id) ?? []}
                instructorIds={instructorIds}
                now={now}
                user={user}
                onError={setError}
              />
            ))
          )}
        </section>

        <aside className="grid gap-3">
          <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              This week
            </p>
            <p className="mt-2 text-2xl font-bold text-[var(--color-ink)]">
              {week.posts} post{week.posts === 1 ? "" : "s"}
            </p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              {week.questions} question{week.questions === 1 ? "" : "s"} · {week.shares} share
              {week.shares === 1 ? "" : "s"}
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              {week.activeMembers}
              {memberCount !== null ? ` of ${memberCount}` : ""} active
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WaitingCard({
  post,
  replies,
  instructorIds,
  now,
  user,
  onError,
}: {
  post: CommunityPost;
  replies: CommunityComment[];
  instructorIds: string[];
  now: number;
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [markAsAnswer, setMarkAsAnswer] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const waiting = waitingFor(post, now);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = body.trim();
    if (next.length < 3) {
      onError("Write your answer first.");
      return;
    }
    onError("");
    setIsSaving(true);
    try {
      const { id } = await createCommunityComment({
        postId: post.id,
        courseSlug: post.courseSlug,
        body: next,
        user,
      });
      if (markAsAnswer) {
        await setCommunityPostAcceptedAnswer(post.id, id);
      }
      setBody("");
      setOpen(false);
    } catch {
      onError("We could not post your answer. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const otherReplies = replies.filter((reply) => !isInstructor(reply, instructorIds));

  return (
    <article
      aria-label={post.title ?? post.body.slice(0, 60)}
      className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)]"
    >
      <h3 className="text-base font-bold leading-6 text-[var(--color-ink)]">
        {post.title ?? post.body}
      </h3>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {post.authorName}
        {post.lessonTitle ? ` · ${post.lessonTitle}` : ""}
        {" · "}
        <span className={waiting.overdue ? "font-bold text-[var(--color-danger-fg)]" : ""}>
          {waiting.label}
        </span>
      </p>
      {post.title && post.body ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-soft)]">{post.body}</p>
      ) : null}
      {otherReplies.length > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          {otherReplies.length} student repl{otherReplies.length === 1 ? "y" : "ies"} so far —{" "}
          {formatNotificationTime(otherReplies[otherReplies.length - 1].createdAt)}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={handleSubmit} className="mt-3 grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="sr-only">Your answer</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              autoFocus
              placeholder="Write the answer here…"
              className="field-input min-h-[88px] resize-y"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--color-ink)]">
              <input
                type="checkbox"
                checked={markAsAnswer}
                onChange={(event) => setMarkAsAnswer(event.target.checked)}
              />
              <CheckCircle2 size={14} aria-hidden className="text-[rgb(21,128,61)]" />
              Mark as the answer
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="button-outline min-h-11 px-3 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={isSaving} className="button-solid min-h-11 px-4 text-sm disabled:opacity-60">
                {isSaving ? "Posting…" : "Post answer"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="button-solid mt-3 min-h-11 px-4 text-sm"
        >
          Answer
        </button>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------

function UpdateComposer({
  courseId,
  user,
  onError,
}: {
  courseId: string;
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pin, setPin] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = body.trim();
    if (next.length < 8) {
      onError("Write a little more before posting the update.");
      return;
    }
    onError("");
    setIsSaving(true);
    try {
      const { id } = await createCommunityPost({
        courseSlug: courseId,
        category: "announcement",
        body: next,
        user,
      });
      if (pin) {
        await setCommunityPostPinned(id, true);
      }
      setBody("");
      setOpen(false);
    } catch {
      onError("We could not post the update.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="button-solid min-h-11 px-4 text-sm">
        Post an update
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Post an update"
      className="grid w-full gap-2 rounded-[14px] border border-[var(--color-primary)] bg-white p-4 shadow-[var(--shadow-soft)] lg:max-w-[560px]"
    >
      <label className="grid gap-1 text-sm">
        <span className="sr-only">Your update</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          autoFocus
          placeholder="What should the cohort know this week?"
          className="field-input min-h-[88px] resize-y"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-[var(--color-ink)]">
          <input type="checkbox" checked={pin} onChange={(event) => setPin(event.target.checked)} />
          <Pin size={14} aria-hidden />
          Pin to the top
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="button-outline min-h-11 px-3 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="button-solid min-h-11 px-4 text-sm disabled:opacity-60">
            {isSaving ? "Posting…" : "Post update"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

/** Mediana, em horas, entre a pergunta e a PRIMEIRA resposta do instrutor.
 *  Sem pergunta respondida pelo instrutor, nao ha numero — e nao se inventa. */
export function medianInstructorReplyHours(
  posts: CommunityPost[],
  comments: CommunityComment[],
  instructorIds: string[],
): number | null {
  const byPost = groupCommentsByPost(comments);
  const hours: number[] = [];
  for (const post of posts) {
    if (post.category !== "question") continue;
    const first = (byPost.get(post.id) ?? []).find((c) => isInstructor(c, instructorIds));
    if (!first) continue;
    const delta = toMillis(first.createdAt) - toMillis(post.createdAt);
    if (delta >= 0) hours.push(delta / 3_600_000);
  }
  if (hours.length === 0) return null;
  hours.sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
