"use client";

import { CheckCircle2, HelpCircle, Pin, Radio, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import { formatNotificationTime } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { CommunityItemActions } from "@/components/learn/community-item-actions";
import { CommunityPostDrawer } from "@/components/learn/community-post-drawer";
import { BusyLabel } from "@/components/ui/busy-label";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
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
  withoutDeleted,
  type CommunityFeedFilter,
} from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  EVENT_STARTING_SOON_MS,
  formatEventDateTime,
  getEventLiveState,
  pickClosestEvent,
  type CourseEvent,
} from "@/domain/course-event";
import { noJoinLinkKey } from "@/components/learn/live-session-parts";
import type { Enrollment } from "@/domain/enrollment";
import { getSafeExternalUrl } from "@/domain/external-url";
import type { CommunitySpace } from "@/domain/learning";
import {
  createCommunityComment,
  createCommunityPost,
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
import { isRateLimitError } from "@/lib/data/rate-limit-error";

// A comunidade simplificada (mockup 5, rodada 11a/11c/11e).
//
// POR QUE ISTO EXISTE
//
// The previous screen showed everything a community CAN have: six spaces
// with counts, Latest/Top/Unanswered, a composer with five types, space
// and role chips on every post, ranking and a rules card. This one shows
// o que ela DEVE ter: um feed, tres filtros (All · Questions · From
// <instructor>), two actions (Ask a question · Share), a light card with the
// first answer inside, and a column with what is happening right now.
// New posts from other people do not push the screen: they become the
// "N new posts" pill until the person wants to see them.

export type CommunityFeedLesson = {
  id: string;
  title: string;
  number: number;
};

type CommunityFeedProps = {
  space: CommunitySpace;
  /** The lesson open in the classroom — "Ask a question" is born with it attached. */
  currentLesson?: CommunityFeedLesson | null;
  /** Instructor name for the "From <name>" filter. */
  instructorName?: string | null;
  /** Who is an instructor besides whoever wrote with the teacher role. */
  instructorIds?: string[];
  /** The viewer moderates this space (course owner): pins posts, publishes notices,
   *  deletes any member's post and reply. */
  canModerate?: boolean;
  /** The course owner opening "as a member" has no enrollment; do not block them. */
  skipEnrollmentGate?: boolean;
  /** Post open in the drawer — comes from the route .../community/q/<post>. */
  openPostId?: string | null;
};

const SAY_HI_WINDOW_MS = 7 * 24 * 3_600_000;
// The card shows up 24 h before; when the session ends it comes from the common window
// (getEventLiveState, course-event.ts).
const LIVE_SOON_WINDOW_MS = 24 * 3_600_000;

export function CommunityFeed({
  space,
  currentLesson = null,
  instructorName = null,
  instructorIds = [],
  canModerate = false,
  skipEnrollmentGate = false,
  openPostId = null,
}: CommunityFeedProps) {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // "/learn/courses/<course>/community" — without the drawer ("/q/<post>") at the end.
  const communityPath = pathname.replace(/\/q\/[^/]+$/, "");
  const openPost = useCallback(
    (postId: string) => router.push(`${communityPath}/q/${encodeURIComponent(postId)}`),
    [communityPath, router],
  );
  const closePost = useCallback(() => router.push(communityPath), [communityPath, router]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [enrollmentReady, setEnrollmentReady] = useState(skipEnrollmentGate);
  // Dictionary key, not text: the language can change with the error on screen.
  const [error, setError] = useState("");
  // "Posted." in the status region after publishing: the list stopped being
  // aria-live, the post itself goes straight into it and the form closes, so
  // screen reader users heard nothing. It goes away after a few seconds
  // so the next post is announced again.
  const [posted, setPosted] = useState(false);
  useEffect(() => {
    if (!posted) return;
    const timer = window.setTimeout(() => setPosted(false), 4000);
    return () => window.clearTimeout(timer);
  }, [posted]);

  // Feed: `all` is everything that arrived; `visible` is what is on screen; `pending`
  // are posts by OTHER people that arrived through realtime and wait for the person to
  // click the pill. Your own posts go in right away (whoever publishes wants to see
  // o que publicou).
  const [feed, setFeed] = useState<{
    all: CommunityPost[];
    visible: CommunityPost[];
    pending: number;
    ready: boolean;
  }>({ all: [], visible: [], pending: 0, ready: false });
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [online, setOnline] = useState<PresentMember[]>([]);
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const [filter, setFilter] = useState<CommunityFeedFilter>("all");
  const [query, setQuery] = useState("");
  const [asideView, setAsideView] = useState<"none" | "members" | "rules">("none");
  // What this person just deleted: it disappears right away, even if an old
  // realtime read still brings it back.
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const hide = useCallback((id: string) => setDeleted((current) => new Set(current).add(id)), []);

  // READ failures kept apart from `error` (the composer's): each one with its own
  // "Try again", which re-reads through the same channel and only goes away when the read comes back.
  const [accessFailed, setAccessFailed] = useState(false);
  const [postsFailed, setPostsFailed] = useState(false);
  const enrollmentSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const postsSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  // The feed title is the fixed focus point when the button goes away; the access
  // gate, while the enrollment has not arrived.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gateRef = useRef<HTMLElement>(null);
  const focusFeedOnOpen = useRef(false);

  useEffect(() => {
    if (!user || skipEnrollmentGate) {
      return;
    }
    const current = subscribeToEnrollment(
      user.uid,
      space.courseSlug,
      (next) => {
        setEnrollment(next);
        setAccessFailed(false);
        setEnrollmentReady(true);
      },
      () => {
        // It failed again: focus does not jump on its own to a good read later on.
        focusFeedOnOpen.current = false;
        setAccessFailed(true);
        setEnrollmentReady(true);
      },
    );
    enrollmentSubscription.current = current;
    return () => {
      enrollmentSubscription.current = null;
      current();
    };
  }, [skipEnrollmentGate, space.courseSlug, user]);

  const canRead = skipEnrollmentGate || Boolean(enrollment);

  // The gate goes away when the access "Try again" succeeds: focus moves on to the
  // feed title, instead of falling on <body>.
  useEffect(() => {
    if (canRead && focusFeedOnOpen.current) {
      focusFeedOnOpen.current = false;
      headingRef.current?.focus();
    }
  }, [canRead]);

  function retryAccess() {
    focusFeedOnOpen.current = true;
    return enrollmentSubscription.current?.reload();
  }

  useEffect(() => {
    if (!canRead) {
      return;
    }
    const current = subscribeToCommunityPosts(
      space.courseSlug,
      (posts) => {
        setFeed((current) => {
          if (!current.ready) {
            return { all: posts, visible: posts, pending: 0, ready: true };
          }
          const known = new Set(current.visible.map((post) => post.id));
          const arrivals = posts.filter(
            (post) => !known.has(post.id) && post.authorId !== user?.uid,
          );
          if (arrivals.length === 0) {
            return { all: posts, visible: posts, pending: 0, ready: true };
          }
          const arrivalIds = new Set(arrivals.map((post) => post.id));
          return {
            all: posts,
            visible: posts.filter((post) => !arrivalIds.has(post.id)),
            pending: arrivals.length,
            ready: true,
          };
        });
        setPostsFailed(false);
      },
      () => {
        // The feed does not change: posts already on screen stay, with the notice above them.
        // With no good read it stays "not ready", and the first one that
        // arrives after "Try again" goes straight in, not as "N new posts".
        setPostsFailed(true);
      },
    );
    postsSubscription.current = current;
    return () => {
      postsSubscription.current = null;
      current();
    };
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

  // "Live in 40 min" has to move on its own.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const instructorSet = useMemo(() => new Set(instructorIds), [instructorIds]);
  const commentsByPost = useMemo(
    () => groupCommentsByPost(withoutDeleted(comments, deleted)),
    [comments, deleted],
  );
  const livePosts = useMemo(() => withoutDeleted(feed.visible, deleted), [deleted, feed.visible]);
  const shownPosts = useMemo(
    () => filterPosts(livePosts, filter, instructorSet, query),
    [livePosts, filter, instructorSet, query],
  );
  const openQuestionCount = useMemo(() => countOpenQuestions(livePosts), [livePosts]);

  const members = useMemo(() => {
    const byId = new Map<string, string>();
    for (const post of feed.visible) byId.set(post.authorId, post.authorName);
    for (const comment of comments) byId.set(comment.authorId, comment.authorName);
    return [...byId.entries()].map(([uid, name]) => ({ uid, name }));
  }, [comments, feed.visible]);

  const nextLive = useMemo(() => pickNextLive(events, now), [events, now]);
  const isNewHere =
    Boolean(enrollment) && now - toMillis(enrollment?.createdAt) < SAY_HI_WINDOW_MS;
  // The drawer finds the post among everything that arrived — including what is still waiting
  // in the pill (a shared link points to a post the person never saw).
  const drawerPost = useMemo(
    () =>
      openPostId && !deleted.has(openPostId)
        ? feed.all.find((post) => post.id === openPostId) ?? null
        : null,
    [deleted, feed.all, openPostId],
  );

  function showPending() {
    setFeed((current) => ({ ...current, visible: current.all, pending: 0 }));
  }

  if (!enrollmentReady) {
    // The same shape as the posts' wait, with the filter strip on top: access
    // and posts arrive without changing sentence or jumping.
    return (
      <div className="grid gap-4">
        <div aria-hidden="true" className={`h-11 w-72 max-w-full rounded-md ${feedBone}`} />
        <FeedPostsSkeleton label={t("learn.community.loading")} />
      </div>
    );
  }

  if (!canRead) {
    return (
      <section ref={gateRef} tabIndex={-1} className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learn.community.accessRequired")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          {t("learn.community.gateHeading")}
        </h2>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learn.community.gateDetails")}
        </p>
        {accessFailed ? (
          <LoadErrorAlert className="mt-4" focusRef={gateRef} onRetry={retryAccess}>
            {t("learn.community.accessError")}
          </LoadErrorAlert>
        ) : null}
      </section>
    );
  }

  const instructorLabel = instructorName?.trim() || t("learn.community.instructorFallback");
  const liveChip = nextLive ? liveChipLabel(nextLive, now, t) : null;

  return (
    <div className="community-feed grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="grid gap-4">
        {/* Title only for the screen reader: right above are already the course name
            (h1) and the active "Community" tab, and the eyebrow plus the 24px h2
            repeated both. Out of flow (sr-only), it takes no space in the
            grid. It receives focus when the last visible post is deleted, and then
            shows up (focus:not-sr-only) so focus does not vanish from the screen. */}
        <h2
          ref={headingRef}
          data-community-heading
          tabIndex={-1}
          className="sr-only text-lg font-semibold text-[var(--color-ink)] focus:not-sr-only"
        >
          {space.name.replace(/ community$/i, "")}
        </h2>
        {liveChip ? (
          <p className="lg:hidden">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-success-soft)] px-3 py-1 text-xs font-bold text-[var(--color-success-fg)]">
              <Radio size={12} aria-hidden /> {liveChip}
            </span>
          </p>
        ) : null}

        {/* Three filters in place of six spaces with sorting. They filter a
            list, they do not switch panels: a group with aria-pressed, in the design of the
            app's own segmented selector (light frame, the chosen one in a pill
            with border and shadow). In utilities, and not .studio-range-tabs: the classroom
            swaps the palette through classes (border, bg-white, surface-soft and the
            tints), and .studio-range-tabs would use the platform's in a course
            escuro. */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("learn.community.filters")} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
            {(
              [
                ["all", t("learn.community.all")],
                [
                  "questions",
                  openQuestionCount
                    ? t(`learn.community.${openQuestionCount === 1 ? "questionsOpenOne" : "questionsOpenMany"}`)
                        .replace("{count}", () => String(openQuestionCount))
                    : t("learn.community.questions"),
                ],
                ["instructor", t("learn.community.fromInstructor").replace("{name}", () => instructorLabel)],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`min-h-11 rounded-md border px-4 text-sm font-semibold transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] ${
                  filter === id
                    ? "border-[var(--color-line)] bg-white text-[var(--color-primary)] shadow-[var(--shadow-soft)]"
                    : "border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="ml-auto min-w-[160px] flex-1 sm:flex-none">
            <span className="sr-only">{t("learn.community.search")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("learn.community.searchPlaceholder")}
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
            onPosted={() => setPosted(true)}
          />
        ) : null}

        {postsFailed ? (
          <LoadErrorAlert focusRef={headingRef} onRetry={() => postsSubscription.current?.reload()}>
            {t("learn.community.postsError")}
          </LoadErrorAlert>
        ) : null}

        {error ? <InlineAlert tone="error">{t(error)}</InlineAlert> : null}

        {feed.pending > 0 ? (
          // 76px = the members area top bar (~68px, sticky, z-40)
          // + 8px: with top-2 the notice stuck BEHIND the bar and disappeared.
          <div className="sticky top-[76px] z-10 flex justify-center">
            <button
              type="button"
              onClick={showPending}
              className="min-h-11 rounded-md bg-[var(--color-primary)] px-5 text-sm font-bold text-[var(--color-base)] shadow-[var(--shadow-soft)]"
            >
              {t(`learn.community.${feed.pending === 1 ? "newPostOne" : "newPostMany"}`).replace("{count}", () => String(feed.pending))}
            </button>
          </div>
        ) : null}

        {/* The screen reader hears only the "N new posts" line (or "Posted."
            after publishing). Before, the whole list was aria-live: every
            like and every new post was read out. */}
        <p role="status" className="sr-only">
          {feed.pending > 0
            ? t(`learn.community.${feed.pending === 1 ? "newPostOne" : "newPostMany"}`).replace("{count}", () => String(feed.pending))
            : posted
              ? t("learn.community.composer.posted")
              : ""}
        </p>

        <div className="grid gap-3">
          {/* With the read in error, neither "loading" nor the empty state: only the notice. */}
          {!feed.ready ? (
            postsFailed ? null : <FeedPostsSkeleton label={t("learn.community.feedLoading")} />
          ) : shownPosts.length === 0 && postsFailed ? null : shownPosts.length === 0 ? (
            // The platform's empty list state; h3 like each post's title.
            <EmptyState as="h3" title={t(livePosts.length === 0 ? "learn.community.empty" : "learn.community.emptyFilter")} />
          ) : (
            shownPosts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                comments={commentsByPost.get(post.id) ?? []}
                currentUser={user}
                instructorIds={instructorSet}
                canModerate={canModerate}
                onOpen={() => openPost(post.id)}
                onDeleted={() => hide(post.id)}
              />
            ))
          )}
        </div>
      </div>

      {drawerPost ? (
        <CommunityPostDrawer
          post={drawerPost}
          comments={commentsByPost.get(drawerPost.id) ?? []}
          currentUser={user}
          instructorIds={instructorSet}
          canModerate={canModerate}
          onClose={closePost}
          onHide={hide}
        />
      ) : null}

      <aside className="grid gap-3">
        {/* Only with a live scheduled. Before, the side column always opened with an
            empty "No live scheduled yet." card. */}
        {nextLive ? <LiveCard live={nextLive} now={now} locale={locale} /> : null}

        <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2">
            <span className="flex -space-x-2">
              {online.slice(0, 3).map((member) => (
                <Avatar key={member.uid} name={member.name} online small />
              ))}
            </span>
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("learn.community.online").replace("{count}", () => String(online.length))}
              {members.length
                ? ` · ${t(`learn.community.${members.length === 1 ? "memberOne" : "memberMany"}`).replace("{count}", () => String(members.length))}`
                : ""}
            </p>
          </div>
        </section>

        {isNewHere ? (
          <section className="rounded-lg border border-[rgba(201,154,70,0.35)] bg-[rgba(201,154,70,0.08)] p-4">
            <p className="text-sm font-bold text-[var(--color-ink)]">{t("learn.community.sayHi")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("learn.community.sayHiDetails").replace("{name}", () => instructorLabel)}
            </p>
          </section>
        ) : null}

        <nav aria-label={t("learn.community.sections")} className="grid gap-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setAsideView((view) => (view === "members" ? "none" : "members"))}
            aria-expanded={asideView === "members"}
            className="min-h-11 rounded-md px-3 text-left text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            {t("learn.community.members").replace("{count}", () => String(members.length))}
          </button>
          <button
            type="button"
            onClick={() => setAsideView((view) => (view === "rules" ? "none" : "rules"))}
            aria-expanded={asideView === "rules"}
            className="min-h-11 rounded-md px-3 text-left text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            {t("learn.community.rules")}
          </button>
          {/* The area's community (/learn/areas/...) has no recordings tab. */}
          {pathname.startsWith("/learn/areas/") ? null : (
            <Link
              href={pathname.replace(/\/community(\/.*)?$/, "") + "/lives"}
              className="flex min-h-11 items-center rounded-md px-3 text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            >
              {t("learn.community.recordings")}
            </Link>
          )}
        </nav>

        {asideView === "members" ? (
          <ul className="grid gap-2 rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm">
            {members.length === 0 ? (
              <li className="text-[var(--color-ink-soft)]">{t("learn.community.noMembers")}</li>
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
          <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            <p>{space.description}</p>
            <ul className="mt-3 list-disc pl-5">
              <li>{t("learn.community.rule1")}</li>
              <li>{t("learn.community.rule2")}</li>
              <li>{t("learn.community.rule3")}</li>
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
  onPosted,
}: {
  user: SkillsetUser;
  space: CommunitySpace;
  currentLesson: CommunityFeedLesson | null;
  instructorLabel: string;
  answeredPosts: CommunityPost[];
  canModerate: boolean;
  /** Receives the dictionary KEY (or "" to clear); the parent translates it on screen. */
  onError: (messageKey: string) => void;
  /** Published: the parent announces "Posted." in the feed's status region. */
  onPosted: () => void;
}) {
  const { t, locale } = useTranslation();
  const [mode, setMode] = useState<"idle" | "ask" | "share" | "update">("idle");
  // After publishing the form closes and the button that had focus goes away:
  // focus goes back to the composer field, instead of falling on the page body.
  const promptRef = useRef<HTMLButtonElement>(null);
  const focusPromptAfterPost = useRef(false);
  useEffect(() => {
    if (mode !== "idle" || !focusPromptAfterPost.current) return;
    focusPromptAfterPost.current = false;
    promptRef.current?.focus();
  }, [mode]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The attached lesson follows the lesson open in the classroom until the person removes it —
  // derived, with no effect syncing state: the choice stores WHICH lesson it
  // was made for; if the classroom switches lessons, the choice wins.
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
      onError("learn.community.composer.shortQuestion");
      return;
    }
    if (mode !== "ask" && nextBody.length < 8) {
      onError("learn.community.composer.shortPost");
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
      focusPromptAfterPost.current = true;
      reset();
      onPosted();
    } catch (failure) {
      onError(isRateLimitError(failure) ? "learn.community.rateLimit" : "learn.community.composer.publishError");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white p-3 shadow-[var(--shadow-soft)]">
        <Avatar name={user.displayName ?? ""} small />
        <button
          ref={promptRef}
          type="button"
          onClick={() => setMode("share")}
          // basis-48: at 375px the field was left with 134px (100px in Spanish) and the
          // sentence broke into 3 or 4 lines; now it takes the line and the
          // buttons drop down.
          className="min-h-11 flex-1 basis-48 rounded-md bg-[var(--color-surface-soft)] px-4 text-left text-sm text-[var(--color-ink-muted)]"
        >
          {t("learn.community.composer.prompt")}
        </button>
        <button
          type="button"
          onClick={() => setMode("ask")}
          className="button-solid min-h-11 px-4 text-sm"
        >
          {t("learn.community.composer.ask")}
        </button>
        {/* No "Share" beside it: the fake field already opens the same
            form, and the extra button broke the line on the phone. */}
        {canModerate ? (
          <button
            type="button"
            onClick={() => setMode("update")}
            className="button-outline min-h-11 px-4 text-sm"
          >
            {t("learn.community.composer.update")}
          </button>
        ) : null}
      </div>
    );
  }

  const modeKey = mode === "ask" ? "ask" : mode === "update" ? "update" : "share";

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t(`learn.community.composer.${modeKey}`)}
      className="grid gap-3 rounded-lg border border-[var(--color-primary)] bg-white p-4 shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-center gap-2">
        <Avatar name={user.displayName ?? ""} small />
        <div className="text-sm">
          <p className="font-semibold text-[var(--color-ink)]">
            {firstName(user.displayName, t)}{" "}
            {t(`learn.community.composer.${mode === "ask" ? "asks" : mode === "update" ? "posts" : "shares"}`)}
          </p>
          {mode === "ask" ? (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {t("learn.community.composer.answersHere").replace("{name}", () => instructorLabel)}
            </p>
          ) : null}
        </div>
      </div>

      {mode === "ask" ? (
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
          <span className="sr-only">{t("learn.community.composer.questionLabel")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("learn.community.composer.questionPlaceholder")}
            autoFocus
            className="field-input min-h-12 text-base"
          />
        </label>
      ) : null}

      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        <span className="sr-only">
          {t(mode === "ask" ? "learn.community.composer.detailsLabel" : "learn.community.composer.postLabel")}
        </span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          autoFocus={mode !== "ask"}
          placeholder={t(
            mode === "ask"
              ? "learn.community.composer.detailsPlaceholder"
              : mode === "update"
                ? "learn.community.composer.updatePlaceholder"
                : "learn.community.composer.sharePlaceholder",
          )}
          className="field-input min-h-[88px] resize-y"
        />
      </label>

      {mode === "ask" && lesson ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-ink)]">
          {t("learn.community.composer.aboutLesson").replace("{number}", () => String(lesson.number))}
          <button
            type="button"
            onClick={() => setLesson(null)}
            aria-label={t("learn.community.composer.removeLesson").replace("{number}", () => String(lesson.number))}
            className="ml-1 rounded-full p-0.5 hover:bg-white"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ) : null}

      {similar.length > 0 ? (
        <div className="rounded-md border border-[var(--color-success)] bg-[var(--color-success-soft)] p-3 text-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-success-fg)]">
            {t("learn.community.composer.similar")}
          </p>
          <ul className="mt-2 grid gap-1">
            {similar.map((post) => (
              <li key={post.id} className="text-[var(--color-ink)]">
                {t("learn.community.composer.similarItem")
                  .replace("{title}", () => post.title ?? "")
                  .replace("{time}", () => formatNotificationTime(post.createdAt, t, locale))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={reset} className="button-outline min-h-11 px-4 text-sm">
          {t("learn.community.composer.cancel")}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="button-solid min-h-11 px-4 text-sm"
        >
          <BusyLabel
            busy={isSubmitting}
            idle={t(
              mode === "ask"
                ? "learn.community.composer.postQuestion"
                : mode === "update"
                  ? "learn.community.composer.postUpdate"
                  : "learn.community.composer.post",
            )}
            busyText={t("learn.community.composer.posting")}
          />
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
  onOpen,
  onDeleted,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  currentUser: SkillsetUser | null;
  instructorIds: ReadonlySet<string>;
  canModerate: boolean;
  /** Opens the post in the drawer (title and "View N replies"). */
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const { t, locale } = useTranslation();
  const [likes, setLikes] = useState<{ count: number; likerIds: string[] }>({ count: 0, likerIds: [] });
  const [likePending, setLikePending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  // Dictionary key, not text.
  const [replyError, setReplyError] = useState("");

  useEffect(() => subscribeToPostLikes(post.id, setLikes, () => undefined), [post.id]);

  const kind = postKind(post);
  const fromInstructor = isInstructor(post, instructorIds);
  const answered = isAnswered(post);
  const inline = pickInlineReply(post, comments, instructorIds);
  const isOwn = currentUser?.uid === post.authorId;
  // The "like" on your own post is locked: the reason goes along with the button.
  const clapReasonId = useId();
  const liked = currentUser ? likes.likerIds.includes(currentUser.uid) : false;
  const inlineIsAnswer = Boolean(inline && post.acceptedCommentId === inline.id);

  async function toggleLike() {
    if (!currentUser || isOwn || likePending) return;
    setLikePending(true);
    try {
      await setCommunityPostLike(post.id, !liked, currentUser);
    } catch {
      // The counter comes from the listener; a lost toggle does not deserve a modal.
    } finally {
      setLikePending(false);
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    const next = replyBody.trim();
    if (next.length < 3) {
      setReplyError("learn.community.card.shortReply");
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
    } catch (failure) {
      setReplyError(isRateLimitError(failure) ? "learn.community.rateLimit" : "learn.community.card.replyError");
    } finally {
      setIsReplying(false);
    }
  }

  const replies = showAll ? comments : inline ? [inline] : [];

  return (
    <article
      data-community-item
      aria-label={post.title ?? post.body.slice(0, 60)}
      // The instructor's post is marked by the "· Instructor" in the header; the
      // colored border on the left is forbidden by the design contract.
      className="rounded-lg border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)]"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <Avatar name={post.authorName} small />
        <span className="text-sm font-semibold text-[var(--color-ink)]">{post.authorName}</span>
        {fromInstructor ? (
          <span className="font-semibold text-[var(--color-primary)]">· {t("learn.community.card.instructor")}</span>
        ) : null}
        <span>· {formatNotificationTime(post.createdAt, t, locale)}</span>
        {post.pinned ? (
          <span className="inline-flex items-center gap-1">
            <Pin size={11} aria-hidden /> {t("learn.community.card.pinned")}
          </span>
        ) : null}
        {post.lessonTitle ? (
          <span>· {t("learn.community.card.fromLesson").replace("{lesson}", () => post.lessonTitle ?? "")}</span>
        ) : null}
        {kind === "question" ? (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
              answered
                ? "bg-[var(--color-success-soft)] text-[var(--color-success-fg)]"
                : "bg-[var(--color-surface-soft)] text-[var(--color-ink-soft)]"
            }`}
          >
            {answered ? <CheckCircle2 size={12} aria-hidden /> : <HelpCircle size={12} aria-hidden />}
            {t(answered ? "learn.community.card.answered" : "learn.community.card.question")}
          </span>
        ) : null}
      </header>

      {post.title ? (
        <h3 className="mt-3 text-base font-bold leading-6 text-[var(--color-ink)]">
          <button
            type="button"
            onClick={onOpen}
            className="text-left hover:underline"
          >
            {post.title}
          </button>
        </h3>
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
          aria-label={t("learn.community.card.clap").replace("{count}", () => String(likes.count))}
          aria-describedby={isOwn ? clapReasonId : undefined}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 ${liked ? "bg-[var(--color-surface-soft)] text-[var(--color-ink)]" : "hover:bg-[var(--color-surface-soft)]"} disabled:opacity-60`}
        >
          {/* Icon, not emoji (the design contract forbids emoji in the interface). */}
          <ThumbsUp size={14} aria-hidden />
          {likes.count}
        </button>
        {/* The reason in plain sight, beside the locked button: before, only the screen
            reader knew why the "Like" on your own post did not respond. */}
        {isOwn ? (
          <span id={clapReasonId} className="font-normal text-[var(--color-ink-soft)]">
            {t("learn.community.card.clapOwn")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setReplyOpen((open) => !open)}
          className="min-h-11 rounded-md px-3 hover:bg-[var(--color-surface-soft)]"
        >
          {t("learn.community.card.reply")}
        </button>
        {comments.length > 1 && !showAll ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-h-11 rounded-md px-3 hover:bg-[var(--color-surface-soft)]"
          >
            {t("learn.community.card.viewReplies").replace("{count}", () => String(comments.length))}
          </button>
        ) : null}
        {/* Pin, Delete and Report live here, with a 44px touch target
            (the "Pin" in the header was 24px). */}
        <CommunityItemActions
          post={post}
          currentUser={currentUser}
          canModerate={canModerate}
          onDeleted={onDeleted}
        />
      </footer>

      {replies.length > 0 ? (
        <ul className="mt-3 grid gap-2 border-t border-[var(--color-line)] pt-3">
          {replies.map((reply) => {
            const isAnswer = post.acceptedCommentId === reply.id;
            const replyFromInstructor = isInstructor(reply, instructorIds);
            return (
              <li
                key={reply.id}
                className={`flex gap-2 rounded-md p-2 text-sm ${
                  isAnswer ? "bg-[var(--color-success-soft)]" : ""
                }`}
              >
                <Avatar name={reply.authorName} small />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    <span className="font-semibold text-[var(--color-ink)]">{reply.authorName}</span>
                    {replyFromInstructor ? ` · ${t("learn.community.card.instructor")}` : ""}
                    {isAnswer ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 font-bold text-[var(--color-success-fg)]">
                        <CheckCircle2 size={11} aria-hidden /> {t("learn.community.card.answer")}
                      </span>
                    ) : null}
                    {" · "}
                    {formatNotificationTime(reply.createdAt, t, locale)}
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
            <span className="sr-only">{t("learn.community.card.replyLabel")}</span>
            <textarea
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              rows={2}
              autoFocus
              placeholder={t("learn.community.card.replyPlaceholder")}
              className="field-input min-h-[64px] resize-y"
            />
          </label>
          {replyError ? (
            <InlineAlert tone="error" className="px-3 py-2 text-xs leading-5">{t(replyError)}</InlineAlert>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReplyOpen(false)} className="button-outline min-h-11 px-3 text-sm">
              {t("learn.community.composer.cancel")}
            </button>
            <button type="submit" disabled={isReplying} className="button-solid min-h-11 px-3 text-sm">
              <BusyLabel
                busy={isReplying}
                idle={t("learn.community.card.postReply")}
                busyText={t("learn.community.composer.posting")}
              />
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------

function LiveCard({ live, now, locale }: { live: CourseEvent; now: number; locale: string }) {
  const { t } = useTranslation();
  const state = getEventLiveState(live.startsAt, now);
  const running = state === "live";
  // The join link shows up 15 min before, as on the other screens (before, only
  // after the start).
  const canJoin = running || state === "startingSoon";
  const safeJoinUrl = getSafeExternalUrl(live.externalUrl);
  return (
    <section
      aria-label={t("learn.community.live.next")}
      className={`rounded-lg border p-4 shadow-[var(--shadow-soft)] ${
        running
          ? "border-[var(--color-success)] bg-[var(--color-success-soft)]"
          : "border-[var(--color-line)] bg-white"
      }`}
    >
      <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-success-fg)]">
        <Radio size={12} aria-hidden /> {liveChipLabel(live, now, t)}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{live.title}</p>
      {/* The same sentence as the other screens, with date and time zone (before "Wed 04:00 PM"). */}
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        {formatEventDateTime(live.startsAt, locale, t("platform.events.datePending"))}
      </p>
      {canJoin && safeJoinUrl ? (
        <a
          href={safeJoinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="button-solid mt-3 inline-flex min-h-11 items-center px-4 text-sm"
        >
          {t("learn.community.live.join")}
        </a>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          {safeJoinUrl
            ? t("learn.community.live.joinLater").replace("{minutes}", () => String(EVENT_STARTING_SOON_MS / 60_000))
            : t(noJoinLinkKey(live.type))}
        </p>
      )}
    </section>
  );
}

// The session whose start is nearest to now (pickClosestEvent): the oldest
// stayed "live" for 3 h and hid the next one. A deadline is not live: it stays out.
function pickNextLive(events: CourseEvent[], now: number): CourseEvent | null {
  return pickClosestEvent(
    events.filter((event) => {
      const startsAt = Date.parse(event.startsAt);
      return event.type !== "deadline"
        && startsAt <= now + LIVE_SOON_WINDOW_MS
        && getEventLiveState(event.startsAt, now) !== "over";
    }),
    now,
  );
}

function liveChipLabel(live: CourseEvent, now: number, t: (key: string) => string): string {
  const diff = Date.parse(live.startsAt) - now;
  if (diff <= 0) {
    return t("learn.community.live.now");
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) {
    return t("learn.community.live.inMinutes").replace("{count}", () => String(minutes));
  }
  const hours = Math.round(minutes / 60);
  return t("learn.community.live.inHours").replace("{count}", () => String(hours));
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
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--color-success)]" />
      ) : null}
    </span>
  );
}

// Bones of the feed waits: in the classroom, the course line (--ma-line), like the
// other classroom waits; outside it, the tone of the app's own skeletons.
const feedBone = "bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse";

// Two post cards in place of the "Loading..." sentence: the sentence stays only for the
// screen reader, in a role="status".
function FeedPostsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="grid gap-3">
      <span className="sr-only">{label}</span>
      {[0, 1].map((item) => (
        <div key={item} aria-hidden="true" className="grid gap-3 rounded-lg border border-[var(--color-line)] p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className={`h-9 w-9 shrink-0 rounded-full ${feedBone}`} />
            <span className={`h-3 w-1/3 rounded-sm ${feedBone}`} />
          </div>
          <span className={`h-3 w-4/5 rounded-sm ${feedBone}`} />
          <span className={`h-3 w-3/5 rounded-sm ${feedBone}`} />
        </div>
      ))}
    </div>
  );
}

function firstName(displayName: string | null | undefined, t: (key: string) => string): string {
  return displayName?.trim().split(/\s+/)[0] || t("learn.community.composer.you");
}
