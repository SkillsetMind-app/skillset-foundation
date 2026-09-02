"use client";

import { CheckCircle2, HelpCircle, Pin, Radio, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import type { SkillsetUser } from "@/domain/auth";
import {
  countOpenQuestions,
  filterPosts,
  findSimilarAnswered,
  groupCommentsByPost,
  isAnswered,
  isInstructor,
  pickInlineReply,
  postKind,
  toMillis,
  type CommunityFeedFilter,
} from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { CourseEvent } from "@/domain/course-event";
import type { Enrollment } from "@/domain/enrollment";
import type { CommunitySpace } from "@/domain/learning";
import {
  createCommunityComment,
  createCommunityPost,
  setCommunityPostPinned,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";
import {
  subscribeToCommunityPresence,
  type PresentMember,
} from "@/lib/data/community-presence";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { setCommunityPostLike, subscribeToPostLikes } from "@/lib/data/gamification";

// A comunidade simplificada (mockup 5, rodada 11a/11c/11e).
//
// POR QUE ISTO EXISTE
//
// A tela anterior mostrava tudo o que uma comunidade PODE ter: seis espacos
// com contagem, Latest/Top/Unanswered, um compositor com cinco tipos, chips
// de espaco e de papel em cada post, ranking e cartao de regras. Esta mostra
// o que ela DEVE ter: um feed, tres filtros (All · Questions · From
// <instrutor>), duas acoes (Ask a question · Share), cartao leve com a
// primeira resposta dentro, e uma coluna com o que esta acontecendo agora.
// Posts novos de outras pessoas nao empurram a tela: viram a pilula
// "N new posts" ate a pessoa querer ve-los.

export type CommunityFeedLesson = {
  id: string;
  title: string;
  number: number;
};

type CommunityFeedProps = {
  space: CommunitySpace;
  /** A aula aberta na sala — "Ask a question" ja nasce com ela anexada. */
  currentLesson?: CommunityFeedLesson | null;
  /** Nome do instrutor para o filtro "From <nome>". */
  instructorName?: string | null;
  /** Quem e instrutor alem de quem escreveu com papel de professor. */
  instructorIds?: string[];
  /** O viewer modera este espaco (dono do curso): fixa posts, publica avisos. */
  canModerate?: boolean;
  /** O dono do curso abrindo "como membro" nao tem matricula; nao barrar. */
  skipEnrollmentGate?: boolean;
};

const SAY_HI_WINDOW_MS = 7 * 24 * 3_600_000;
const LIVE_SOON_WINDOW_MS = 24 * 3_600_000;
const LIVE_RUNNING_WINDOW_MS = 3 * 3_600_000;

export function CommunityFeed({
  space,
  currentLesson = null,
  instructorName = null,
  instructorIds = [],
  canModerate = false,
  skipEnrollmentGate = false,
}: CommunityFeedProps) {
  const { user } = useAuth();
  const pathname = usePathname() ?? "";
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [enrollmentReady, setEnrollmentReady] = useState(skipEnrollmentGate);
  const [error, setError] = useState("");

  // Feed: `visible` e o que esta na tela; `pending` sao posts de OUTRAS
  // pessoas que chegaram pelo realtime e esperam a pessoa clicar na pilula.
  // Os proprios posts entram na hora (quem publica quer ver o que publicou).
  const latestPosts = useRef<CommunityPost[]>([]);
  const [feed, setFeed] = useState<{
    visible: CommunityPost[];
    pending: number;
    ready: boolean;
  }>({ visible: [], pending: 0, ready: false });
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [online, setOnline] = useState<PresentMember[]>([]);
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const [filter, setFilter] = useState<CommunityFeedFilter>("all");
  const [query, setQuery] = useState("");
  const [asideView, setAsideView] = useState<"none" | "members" | "rules">("none");

  useEffect(() => {
    if (!user || skipEnrollmentGate) {
      return;
    }
    return subscribeToEnrollment(
      user.uid,
      space.courseSlug,
      (next) => {
        setEnrollment(next);
        setEnrollmentReady(true);
      },
      () => {
        setError("We could not confirm your community access.");
        setEnrollmentReady(true);
      },
    );
  }, [skipEnrollmentGate, space.courseSlug, user]);

  const canRead = skipEnrollmentGate || Boolean(enrollment);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    return subscribeToCommunityPosts(
      space.courseSlug,
      (posts) => {
        latestPosts.current = posts;
        setFeed((current) => {
          if (!current.ready) {
            return { visible: posts, pending: 0, ready: true };
          }
          const known = new Set(current.visible.map((post) => post.id));
          const arrivals = posts.filter(
            (post) => !known.has(post.id) && post.authorId !== user?.uid,
          );
          if (arrivals.length === 0) {
            return { visible: posts, pending: 0, ready: true };
          }
          const arrivalIds = new Set(arrivals.map((post) => post.id));
          return {
            visible: posts.filter((post) => !arrivalIds.has(post.id)),
            pending: arrivals.length,
            ready: true,
          };
        });
      },
      () => {
        setError("We could not load community posts.");
        setFeed({ visible: [], pending: 0, ready: true });
      },
    );
  }, [canRead, space.courseSlug, user?.uid]);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    return subscribeToCourseCommunityComments(space.courseSlug, setComments, () => undefined);
  }, [canRead, space.courseSlug]);

  useEffect(() => {
    if (!canRead || !user) {
      return;
    }
    return subscribeToCommunityPresence(space.courseSlug, user, setOnline);
  }, [canRead, space.courseSlug, user]);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    return subscribeToCourseEvents(space.courseSlug, setEvents, () => undefined);
  }, [canRead, space.courseSlug]);

  // "Live in 40 min" tem que andar sozinho.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const instructorSet = useMemo(() => new Set(instructorIds), [instructorIds]);
  const commentsByPost = useMemo(() => groupCommentsByPost(comments), [comments]);
  const shownPosts = useMemo(
    () => filterPosts(feed.visible, filter, instructorSet, query),
    [feed.visible, filter, instructorSet, query],
  );
  const openQuestionCount = useMemo(() => countOpenQuestions(feed.visible), [feed.visible]);

  const members = useMemo(() => {
    const byId = new Map<string, string>();
    for (const post of feed.visible) byId.set(post.authorId, post.authorName);
    for (const comment of comments) byId.set(comment.authorId, comment.authorName);
    return [...byId.entries()].map(([uid, name]) => ({ uid, name }));
  }, [comments, feed.visible]);

  const nextLive = useMemo(() => pickNextLive(events, now), [events, now]);
  const isNewHere =
    Boolean(enrollment) && now - toMillis(enrollment?.createdAt) < SAY_HI_WINDOW_MS;

  function showPending() {
    setFeed({ visible: latestPosts.current, pending: 0, ready: true });
  }

  if (!enrollmentReady) {
    return <p className="text-sm text-[var(--color-ink-soft)]">Loading community...</p>;
  }

  if (!canRead) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Access required
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          This community is linked to course enrollment.
        </h2>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          Open the course page first and add it to your learning workspace.
        </p>
      </section>
    );
  }

  const instructorLabel = instructorName?.trim() || "the instructor";
  const liveChip = nextLive ? liveChipLabel(nextLive, now) : null;

  return (
    <div className="community-feed grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="grid gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Community
            </p>
            <h2 className="display-title mt-1 text-2xl text-[var(--color-ink)]">
              {space.name.replace(/ community$/i, "")}
            </h2>
          </div>
          {liveChip ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(22,163,74,0.1)] px-3 py-1 text-xs font-bold text-[rgb(21,128,61)] lg:hidden">
              <Radio size={12} aria-hidden /> {liveChip}
            </span>
          ) : null}
        </header>

        {/* Tres filtros no lugar de seis espacos com ordenacao. */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Filter posts" className="flex flex-wrap gap-1">
            {(
              [
                ["all", "All"],
                ["questions", openQuestionCount ? `Questions · ${openQuestionCount} open` : "Questions"],
                ["instructor", `From ${instructorLabel}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${
                  filter === id
                    ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                    : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="ml-auto min-w-[160px] flex-1 sm:flex-none">
            <span className="sr-only">Search posts</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="field-input min-h-11"
            />
          </label>
        </div>

        {user ? (
          <Composer
            user={user}
            space={space}
            currentLesson={currentLesson}
            instructorLabel={instructorLabel}
            answeredPosts={feed.visible}
            canModerate={canModerate}
            onError={setError}
          />
        ) : null}

        {error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {error}
          </p>
        ) : null}

        {feed.pending > 0 ? (
          <div className="sticky top-2 z-10 flex justify-center">
            <button
              type="button"
              onClick={showPending}
              className="min-h-11 rounded-full bg-[var(--color-primary)] px-5 text-sm font-bold text-[var(--color-base)] shadow-[var(--shadow-soft)]"
            >
              {feed.pending} new post{feed.pending === 1 ? "" : "s"}
            </button>
          </div>
        ) : null}

        <div className="grid gap-3" aria-live="polite">
          {!feed.ready ? (
            <p className="text-sm text-[var(--color-ink-soft)]">Loading community feed...</p>
          ) : shownPosts.length === 0 ? (
            <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              {feed.visible.length === 0
                ? "No posts yet. Ask the first question or share what you're working on."
                : "Nothing matches this filter."}
            </p>
          ) : (
            shownPosts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                comments={commentsByPost.get(post.id) ?? []}
                currentUser={user}
                instructorIds={instructorSet}
                canModerate={canModerate}
              />
            ))
          )}
        </div>
      </div>

      <aside className="grid gap-3">
        <LiveCard live={nextLive} now={now} />

        <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2">
            <span className="flex -space-x-2">
              {online.slice(0, 3).map((member) => (
                <Avatar key={member.uid} name={member.name} online small />
              ))}
            </span>
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {online.length} online
              {members.length ? ` · ${members.length} member${members.length === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </section>

        {isNewHere ? (
          <section className="rounded-[14px] border border-[rgba(201,154,70,0.35)] bg-[rgba(201,154,70,0.08)] p-4">
            <p className="text-sm font-bold text-[var(--color-ink)]">New here? Say hi 👋</p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
              {instructorLabel} replies to every intro.
            </p>
          </section>
        ) : null}

        <nav aria-label="Community sections" className="grid gap-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setAsideView((view) => (view === "members" ? "none" : "members"))}
            aria-expanded={asideView === "members"}
            className="min-h-11 rounded-[10px] px-3 text-left text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            Members ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setAsideView((view) => (view === "rules" ? "none" : "rules"))}
            aria-expanded={asideView === "rules"}
            className="min-h-11 rounded-[10px] px-3 text-left text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            Rules
          </button>
          <Link
            href={pathname.replace(/\/community(\/.*)?$/, "") + "/lives"}
            className="flex min-h-11 items-center rounded-[10px] px-3 text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            Recordings
          </Link>
        </nav>

        {asideView === "members" ? (
          <ul className="grid gap-2 rounded-[14px] border border-[var(--color-line)] bg-white p-4 text-sm">
            {members.length === 0 ? (
              <li className="text-[var(--color-ink-soft)]">No one has posted yet.</li>
            ) : (
              members.map((member) => (
                <li key={member.uid} className="flex items-center gap-2">
                  <Avatar name={member.name} online={online.some((m) => m.uid === member.uid)} small />
                  <span className="text-[var(--color-ink)]">{member.name}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {asideView === "rules" ? (
          <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            <p>{space.description}</p>
            <ul className="mt-3 list-disc pl-5">
              <li>Ask about the course; share what you tried.</li>
              <li>Be specific — say which lesson you mean.</li>
              <li>No selling, no spam. Report anything off.</li>
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Composer({
  user,
  space,
  currentLesson,
  instructorLabel,
  answeredPosts,
  canModerate,
  onError,
}: {
  user: SkillsetUser;
  space: CommunitySpace;
  currentLesson: CommunityFeedLesson | null;
  instructorLabel: string;
  answeredPosts: CommunityPost[];
  canModerate: boolean;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "ask" | "share" | "update">("idle");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A aula anexada acompanha a aula aberta na sala ate a pessoa tira-la —
  // derivado, sem efeito sincronizando estado: a escolha guarda PARA QUAL aula
  // foi feita; se a sala trocar de aula, a escolha vence.
  const currentLessonId = currentLesson?.id ?? null;
  const [lessonChoice, setLessonChoice] = useState<{
    forLessonId: string | null;
    lesson: CommunityFeedLesson | null;
  }>({ forLessonId: currentLessonId, lesson: currentLesson });
  const lesson =
    lessonChoice.forLessonId === currentLessonId ? lessonChoice.lesson : currentLesson;
  const setLesson = (next: CommunityFeedLesson | null) =>
    setLessonChoice({ forLessonId: currentLessonId, lesson: next });

  const similar = useMemo(
    () => (mode === "ask" ? findSimilarAnswered(title, answeredPosts) : []),
    [answeredPosts, mode, title],
  );

  function reset() {
    setMode("idle");
    setTitle("");
    setBody("");
    setLesson(currentLesson);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextBody = body.trim();

    if (mode === "ask" && nextTitle.length < 8) {
      onError("Write your question in one line first — at least a few words.");
      return;
    }
    if (mode !== "ask" && nextBody.length < 8) {
      onError("Write a little more before posting.");
      return;
    }

    onError("");
    setIsSubmitting(true);
    try {
      await createCommunityPost({
        courseSlug: space.courseSlug,
        category: mode === "ask" ? "question" : mode === "update" ? "announcement" : "discussion",
        title: mode === "ask" ? nextTitle : null,
        body: nextBody,
        lessonId: mode === "ask" ? lesson?.id ?? null : null,
        lessonTitle: mode === "ask" && lesson ? `lesson ${lesson.number}` : null,
        user,
      });
      reset();
    } catch {
      onError("We could not publish your post.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--color-line)] bg-white p-3 shadow-[var(--shadow-soft)]">
        <Avatar name={user.displayName ?? ""} small />
        <button
          type="button"
          onClick={() => setMode("share")}
          className="min-h-11 flex-1 rounded-[10px] bg-[var(--color-surface-soft)] px-4 text-left text-sm text-[var(--color-ink-muted)]"
        >
          Ask the cohort or share something…
        </button>
        <button
          type="button"
          onClick={() => setMode("ask")}
          className="button-solid min-h-11 px-4 text-sm"
        >
          Ask a question
        </button>
        <button
          type="button"
          onClick={() => setMode("share")}
          className="button-outline min-h-11 px-4 text-sm"
        >
          Share
        </button>
        {canModerate ? (
          <button
            type="button"
            onClick={() => setMode("update")}
            className="button-outline min-h-11 px-4 text-sm"
          >
            Post an update
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={mode === "ask" ? "Ask a question" : mode === "update" ? "Post an update" : "Share"}
      className="grid gap-3 rounded-[14px] border border-[var(--color-primary)] bg-white p-4 shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-center gap-2">
        <Avatar name={user.displayName ?? ""} small />
        <div className="text-sm">
          <p className="font-semibold text-[var(--color-ink)]">
            {firstName(user.displayName)}{" "}
            {mode === "ask" ? "asks a question" : mode === "update" ? "posts an update" : "shares"}
          </p>
          {mode === "ask" ? (
            <p className="text-xs text-[var(--color-ink-muted)]">{instructorLabel} answers questions here.</p>
          ) : null}
        </div>
      </div>

      {mode === "ask" ? (
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
          <span className="sr-only">Your question</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What do you want to ask?"
            autoFocus
            className="field-input min-h-12 text-base"
          />
        </label>
      ) : null}

      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        <span className="sr-only">{mode === "ask" ? "Details (optional)" : "Your post"}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          autoFocus={mode !== "ask"}
          placeholder={
            mode === "ask"
              ? "Add details (optional) — what you tried, what you expected…"
              : mode === "update"
                ? "What should the cohort know this week?"
                : "What are you working on? A win, a doubt, a before/after…"
          }
          className="field-input min-h-[88px] resize-y"
        />
      </label>

      {mode === "ask" && lesson ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-ink)]">
          About lesson {lesson.number}
          <button
            type="button"
            onClick={() => setLesson(null)}
            aria-label={`Remove lesson ${lesson.number}`}
            className="ml-1 rounded-full p-0.5 hover:bg-white"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ) : null}

      {similar.length > 0 ? (
        <div className="rounded-[10px] border border-[rgba(22,163,74,0.35)] bg-[rgba(22,163,74,0.06)] p-3 text-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[rgb(21,128,61)]">
            Already answered · similar
          </p>
          <ul className="mt-2 grid gap-1">
            {similar.map((post) => (
              <li key={post.id} className="text-[var(--color-ink)]">
                “{post.title}” — answered {formatNotificationTime(post.createdAt)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={reset} className="button-outline min-h-11 px-4 text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="button-solid min-h-11 px-4 text-sm disabled:opacity-60"
        >
          {isSubmitting
            ? "Posting…"
            : mode === "ask"
              ? "Post question"
              : mode === "update"
                ? "Post update"
                : "Post"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function FeedCard({
  post,
  comments,
  currentUser,
  instructorIds,
  canModerate,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  currentUser: SkillsetUser | null;
  instructorIds: ReadonlySet<string>;
  canModerate: boolean;
}) {
  const [likes, setLikes] = useState<{ count: number; likerIds: string[] }>({ count: 0, likerIds: [] });
  const [likePending, setLikePending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [replyError, setReplyError] = useState("");

  useEffect(() => subscribeToPostLikes(post.id, setLikes, () => undefined), [post.id]);

  const kind = postKind(post);
  const fromInstructor = isInstructor(post, instructorIds);
  const answered = isAnswered(post);
  const inline = pickInlineReply(post, comments, instructorIds);
  const isOwn = currentUser?.uid === post.authorId;
  const liked = currentUser ? likes.likerIds.includes(currentUser.uid) : false;
  const inlineIsAnswer = Boolean(inline && post.acceptedCommentId === inline.id);

  async function toggleLike() {
    if (!currentUser || isOwn || likePending) return;
    setLikePending(true);
    try {
      await setCommunityPostLike(post.id, !liked, currentUser);
    } catch {
      // O contador vem do listener; um toggle perdido nao merece modal.
    } finally {
      setLikePending(false);
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    const next = replyBody.trim();
    if (next.length < 3) {
      setReplyError("Write a short reply first.");
      return;
    }
    setReplyError("");
    setIsReplying(true);
    try {
      await createCommunityComment({
        postId: post.id,
        courseSlug: post.courseSlug,
        body: next,
        user: currentUser,
      });
      setReplyBody("");
      setReplyOpen(false);
      setShowAll(true);
    } catch {
      setReplyError("We could not publish your reply.");
    } finally {
      setIsReplying(false);
    }
  }

  const replies = showAll ? comments : inline ? [inline] : [];

  return (
    <article
      aria-label={post.title ?? post.body.slice(0, 60)}
      className={`rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] ${
        fromInstructor ? "border-l-4 border-l-[var(--color-primary)]" : ""
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <Avatar name={post.authorName} small />
        <span className="text-sm font-semibold text-[var(--color-ink)]">{post.authorName}</span>
        {fromInstructor ? <span className="font-semibold text-[var(--color-primary)]">· Instructor</span> : null}
        <span>· {formatNotificationTime(post.createdAt)}</span>
        {post.pinned ? (
          <span className="inline-flex items-center gap-1">
            <Pin size={11} aria-hidden /> pinned
          </span>
        ) : null}
        {post.lessonTitle ? <span>· from {post.lessonTitle}</span> : null}
        {kind === "question" ? (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
              answered
                ? "bg-[rgba(22,163,74,0.1)] text-[rgb(21,128,61)]"
                : "bg-[var(--color-surface-soft)] text-[var(--color-ink-soft)]"
            }`}
          >
            {answered ? <CheckCircle2 size={12} aria-hidden /> : <HelpCircle size={12} aria-hidden />}
            {answered ? "Answered" : "Question"}
          </span>
        ) : null}
        {canModerate ? (
          <button
            type="button"
            onClick={() => void setCommunityPostPinned(post.id, !post.pinned)}
            className="text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            {post.pinned ? "Unpin" : "Pin"}
          </button>
        ) : null}
      </header>

      {post.title ? (
        <h3 className="mt-3 text-base font-bold leading-6 text-[var(--color-ink)]">{post.title}</h3>
      ) : null}
      {post.body ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-soft)] line-clamp-3 md:line-clamp-none">
          {post.body}
        </p>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-[var(--color-ink-soft)]">
        <button
          type="button"
          onClick={() => void toggleLike()}
          disabled={!currentUser || isOwn || likePending}
          aria-pressed={liked}
          aria-label={`Clap · ${likes.count}`}
          className={`min-h-11 rounded-full px-3 ${liked ? "bg-[var(--color-surface-soft)] text-[var(--color-ink)]" : "hover:bg-[var(--color-surface-soft)]"} disabled:opacity-70`}
        >
          👏 {likes.count}
        </button>
        <button
          type="button"
          onClick={() => setReplyOpen((open) => !open)}
          className="min-h-11 rounded-full px-3 hover:bg-[var(--color-surface-soft)]"
        >
          Reply
        </button>
        {comments.length > 1 && !showAll ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-11 rounded-full px-3 hover:bg-[var(--color-surface-soft)]"
          >
            View {comments.length} replies
          </button>
        ) : null}
      </footer>

      {replies.length > 0 ? (
        <ul className="mt-3 grid gap-2 border-t border-[var(--color-line)] pt-3">
          {replies.map((reply) => {
            const isAnswer = post.acceptedCommentId === reply.id;
            const replyFromInstructor = isInstructor(reply, instructorIds);
            return (
              <li
                key={reply.id}
                className={`flex gap-2 rounded-[10px] p-2 text-sm ${
                  isAnswer ? "bg-[rgba(22,163,74,0.08)]" : ""
                }`}
              >
                <Avatar name={reply.authorName} small />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    <span className="font-semibold text-[var(--color-ink)]">{reply.authorName}</span>
                    {replyFromInstructor ? " · Instructor" : ""}
                    {isAnswer ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 font-bold text-[rgb(21,128,61)]">
                        <CheckCircle2 size={11} aria-hidden /> answer
                      </span>
                    ) : null}
                    {" · "}
                    {formatNotificationTime(reply.createdAt)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap leading-6 text-[var(--color-ink)]">{reply.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {inlineIsAnswer && !showAll && comments.length > 1 ? null : null}

      {replyOpen ? (
        <form onSubmit={submitReply} className="mt-3 grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="sr-only">Your reply</span>
            <textarea
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              rows={2}
              autoFocus
              placeholder="Add your reply…"
              className="field-input min-h-[64px] resize-y"
            />
          </label>
          {replyError ? (
            <p className="text-xs font-semibold text-[var(--color-danger-fg)]">{replyError}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReplyOpen(false)} className="button-outline min-h-11 px-3 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={isReplying} className="button-solid min-h-11 px-3 text-sm disabled:opacity-60">
              {isReplying ? "Posting…" : "Post reply"}
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------

function LiveCard({ live, now }: { live: CourseEvent | null; now: number }) {
  if (!live) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)]">
        No live scheduled yet.
      </section>
    );
  }
  const startsAt = Date.parse(live.startsAt);
  const running = startsAt <= now;
  return (
    <section
      aria-label="Next live"
      className={`rounded-[14px] border p-4 shadow-[var(--shadow-soft)] ${
        running
          ? "border-[rgba(22,163,74,0.35)] bg-[rgba(22,163,74,0.06)]"
          : "border-[var(--color-line)] bg-white"
      }`}
    >
      <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[rgb(21,128,61)]">
        <Radio size={12} aria-hidden /> {liveChipLabel(live, now)}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{live.title}</p>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        {new Date(startsAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
      </p>
      {running ? (
        <a
          href={live.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="button-solid mt-3 inline-flex min-h-11 items-center px-4 text-sm"
        >
          Join
        </a>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Join when it starts</p>
      )}
    </section>
  );
}

function pickNextLive(events: CourseEvent[], now: number): CourseEvent | null {
  return (
    events
      .filter((event) => {
        const startsAt = Date.parse(event.startsAt);
        return startsAt >= now - LIVE_RUNNING_WINDOW_MS && startsAt <= now + LIVE_SOON_WINDOW_MS;
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null
  );
}

function liveChipLabel(live: CourseEvent, now: number): string {
  const diff = Date.parse(live.startsAt) - now;
  if (diff <= 0) {
    return "Live now";
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) {
    return `Live in ${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  return `Live in ${hours} h`;
}

function Avatar({ name, online = false, small = false }: { name: string; online?: boolean; small?: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] font-bold text-[var(--color-base)] ${
        small ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs"
      }`}
    >
      {initials}
      {online ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[rgb(22,163,74)]" />
      ) : null}
    </span>
  );
}

function firstName(displayName: string | null | undefined): string {
  return displayName?.trim().split(/\s+/)[0] || "You";
}
