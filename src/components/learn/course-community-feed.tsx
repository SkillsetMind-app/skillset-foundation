"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Heart, Pin } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { CommunityLeaderboard } from "@/components/learn/community-leaderboard";
import { LevelBadge } from "@/components/learn/level-badge";
import type { SkillsetUser } from "@/domain/auth";
import type {
  CommunityComment,
  CommunityPost,
  CommunityPostCategory,
} from "@/domain/community-post";
import { communityPostCategoryLabels } from "@/domain/community-post";
import type {
  CommunityReportReason,
  CommunityReportTargetType,
} from "@/domain/community-report";
import { communityReportReasonLabels } from "@/domain/community-report";
import type { Enrollment } from "@/domain/enrollment";
import type { MemberStats } from "@/domain/gamification";
import type { CommunitySpace } from "@/domain/learning";
import {
  createCommunityComment,
  createCommunityPost,
  createCommunityReport,
  setCommunityPostPinned,
  subscribeToCommunityComments,
  subscribeToCommunityPosts,
} from "@/lib/data/community-posts";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import {
  fetchMemberStatsForUids,
  setCommunityPostLike,
  subscribeToPostLikes,
} from "@/lib/data/gamification";

type CourseCommunityFeedProps = {
  space: CommunitySpace;
  // True when the viewer can moderate this space (the course owner, passed from
  // the creator mount). Gates the pin/unpin control. The pinned *render* is
  // always on; only the control is moderator-gated. Defaults to false so the
  // learner mount never shows it.
  canModerate?: boolean;
};

const categories: CommunityPostCategory[] = [
  "announcement",
  "discussion",
  "question",
  "resource",
];
const communityTabs = [
  "posts",
  "leaderboard",
  "about",
  "members",
  "events",
] as const;
type CommunityTab = (typeof communityTabs)[number];

// Stable identity so consumers that memoize on the returned map don't churn
// while there are no members to fetch.
const EMPTY_MEMBER_STATS: Map<string, MemberStats> = new Map();

/**
 * Level-badge stats for an explicit set of members (the viewer + the authors of
 * posts/comments already on screen). Re-fetches only when the set actually
 * changes — `key` is a stable sorted string, so identical sets across renders
 * don't refetch. `member_stats` can't be listed (roster enumeration is blocked
 * by RLS), so this per-uid fetch is the only read path; a stats read failure
 * just omits badges, it never breaks the feed.
 */
function useMemberStats(uids: string[]): Map<string, MemberStats> {
  const key = [...new Set(uids.filter((uid) => uid))].sort().join(",");
  const [stats, setStats] = useState<Map<string, MemberStats>>(
    () => EMPTY_MEMBER_STATS,
  );

  useEffect(() => {
    if (!key) {
      return;
    }
    let active = true;
    fetchMemberStatsForUids(key.split(","))
      .then((map) => {
        if (active) {
          setStats(map);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [key]);

  // With no uids there's nothing to show (and any prior fetch is stale) — return
  // the shared empty map rather than clearing state inside the effect.
  return key ? stats : EMPTY_MEMBER_STATS;
}

export function CourseCommunityFeed({
  space,
  canModerate = false,
}: CourseCommunityFeedProps) {
  const { user } = useAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [postsState, setPostsState] = useState<{
    key: string | null;
    posts: CommunityPost[];
    ready: boolean;
  }>({
    key: null,
    posts: [],
    ready: false,
  });
  const [category, setCategory] = useState<CommunityPostCategory>("discussion");
  const [body, setBody] = useState("");
  const [activeTab, setActiveTab] = useState<CommunityTab>("posts");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Level badges need stats for exactly the members on screen: the viewer plus
  // every post author in this space. Comment authors are fetched per-card so we
  // never pull the whole roster (the collection forbids listing).
  const memberStatUids = useMemo(() => {
    const authorIds =
      postsState.key === space.courseSlug
        ? postsState.posts.map((post) => post.authorId)
        : [];
    return user ? [user.uid, ...authorIds] : authorIds;
  }, [postsState, space.courseSlug, user]);
  const memberStats = useMemberStats(memberStatUids);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToEnrollment(
      user.uid,
      space.courseSlug,
      setEnrollment,
      () => setError("We could not confirm your community access."),
    );
  }, [space.courseSlug, user]);

  useEffect(() => {
    if (!enrollment) {
      return;
    }

    return subscribeToCommunityPosts(
      space.courseSlug,
      (posts) => {
        setPostsState({
          key: space.courseSlug,
          posts,
          ready: true,
        });
      },
      () => {
        setError("We could not load community posts.");
        setPostsState({
          key: space.courseSlug,
          posts: [],
          ready: true,
        });
      },
    );
  }, [enrollment, space.courseSlug]);

  if (!enrollment) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Access required
        </p>
        <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          This community is linked to course enrollment.
        </h3>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          Open the course page first and add it to your learning workspace.
        </p>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const nextBody = body.trim();

    if (nextBody.length < 8) {
      setError("Write a more complete post before publishing.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      await createCommunityPost({
        courseSlug: space.courseSlug,
        category,
        body: nextBody,
        user,
      });
      setBody("");
      setCategory("discussion");
    } catch {
      setError("We could not publish your post.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {space.name}
        </p>
        <h3 className="display-title mt-3 text-4xl text-[var(--color-ink)]">
          Course community
        </h3>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {space.description}
        </p>
        <div className="mt-5 flex flex-wrap gap-2 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-2">
          {communityTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-[8px] px-4 py-2.5 text-sm font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                  : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "posts" ? (
        <div className="grid gap-5">
          <form
            className="community-composer rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] sm:p-5"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-start">
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as CommunityPostCategory)}
                className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold outline-none focus:border-[var(--color-primary-light)]"
                aria-label="Post category"
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {communityPostCategoryLabels[item]}
                  </option>
                ))}
              </select>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={3}
                placeholder="Write a post for this course community..."
                className="min-h-[72px] resize-none rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm outline-none transition focus:border-[var(--color-primary-light)] focus:bg-[var(--color-surface-hover)]"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {isSubmitting ? "Publishing..." : "Post"}
              </button>
            </div>
            {error ? (
              <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
                {error}
              </p>
            ) : null}
          </form>
          <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Feed
            </p>
            <div className="mt-5 grid gap-4">
              {!postsState.ready || postsState.key !== space.courseSlug ? (
                <p className="text-sm text-[var(--color-ink-soft)]">Loading community feed...</p>
              ) : postsState.posts.length === 0 ? (
                <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
                  No posts yet. The first discussion can set the tone for this course space.
                </p>
              ) : (
                postsState.posts.map((post) => (
                  <CommunityPostCard
                    key={post.id}
                    currentUser={user}
                    post={post}
                    memberStats={memberStats}
                    canModerate={canModerate}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "leaderboard" ? (
        <CommunityLeaderboard
          currentUserStats={user ? memberStats.get(user.uid) ?? null : null}
        />
      ) : null}

      {activeTab === "about" ? (
        <CommunityInfoPanel
          title="About this space"
          items={[
            ["Access", space.visibility.replace("_", " ")],
            ["Course", space.name.replace(" community", "")],
            ["Purpose", "Announcements, questions, resources, and course discussion."],
          ]}
        />
      ) : null}

      {activeTab === "members" ? (
        <CommunityMembersPanel
          posts={postsState.key === space.courseSlug ? postsState.posts : []}
          postsReady={postsState.ready && postsState.key === space.courseSlug}
          memberStats={memberStats}
          currentUserId={user?.uid ?? null}
        />
      ) : null}

      {activeTab === "events" ? (
        <CommunityInfoPanel
          title="Events"
          items={[
            ["Live sessions", "Course events are managed from the events workspace."],
            ["External links", "Zoom, Google Meet, and similar links are supported first."],
            ["Recordings", "Teachers can attach live recordings as protected course assets."],
          ]}
          cta={{ href: "/learn/events", label: "Open course events" }}
        />
      ) : null}
    </div>
  );
}

function CommunityInfoPanel({
  title,
  items,
  cta,
}: {
  title: string;
  items: Array<[string, string]>;
  cta?: { href: string; label: string };
}) {
  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Course community
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h3>
      <div className="mt-5 grid gap-3">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
              {label}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
              {value}
            </p>
          </div>
        ))}
      </div>
      {cta ? (
        <Link href={cta.href} className="button-solid mt-6 inline-flex px-4 py-2.5 text-sm">
          {cta.label}
        </Link>
      ) : null}
    </section>
  );
}

function CommunityMembersPanel({
  posts,
  postsReady,
  memberStats,
  currentUserId,
}: {
  posts: CommunityPost[];
  postsReady: boolean;
  memberStats: Map<string, MemberStats>;
  currentUserId: string | null;
}) {
  // Course-scoped roster: the distinct people who have posted in THIS space,
  // joined with their global SkillsetMind standing (level/points come from likes
  // received). Enrollment lists are private by design, so "contributors" is the
  // honest, privacy-safe roster we can show without a new read, rule, or any
  // fabricated "online" status. Both inputs are already subscribed by the
  // parent, so this adds zero fetches.
  const contributors = useMemo(() => {
    const byAuthor = new Map<
      string,
      { uid: string; name: string; role: string }
    >();
    for (const post of posts) {
      if (!byAuthor.has(post.authorId)) {
        byAuthor.set(post.authorId, {
          uid: post.authorId,
          name: post.authorName,
          role: post.authorRole,
        });
      }
    }
    return Array.from(byAuthor.values())
      .map((author) => {
        const stats = memberStats.get(author.uid);
        return {
          ...author,
          level: stats?.level ?? 1,
          points: stats?.points ?? 0,
          likesReceived: stats?.totalLikesReceived ?? 0,
        };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }, [posts, memberStats]);

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Course community
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h3 className="display-title text-3xl text-[var(--color-ink)]">Members</h3>
        {postsReady && contributors.length > 0 ? (
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            {contributors.length}{" "}
            {contributors.length === 1 ? "contributor" : "contributors"}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
        People active in this space, ranked by their SkillsetMind level. Levels and
        points come from likes their community posts have earned.
      </p>

      {!postsReady ? (
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          Loading members...
        </p>
      ) : contributors.length === 0 ? (
        <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          No one has posted here yet. The first people to start a discussion will
          appear in this roster.
        </p>
      ) : (
        <ul className="mt-5 grid gap-2">
          {contributors.map((member, index) => {
            const isCurrentUser = member.uid === currentUserId;
            const initial =
              member.name.trim().charAt(0).toUpperCase() || "?";
            return (
              <li
                key={member.uid}
                className={`flex items-center gap-3 rounded-[14px] border p-3 ${
                  isCurrentUser
                    ? "border-[var(--color-primary)] bg-[var(--color-surface-soft)]"
                    : "fine-rule bg-[var(--color-surface-soft)]"
                }`}
              >
                <span className="w-5 text-right text-xs font-semibold tabular-nums text-[var(--color-ink-soft)]">
                  {index + 1}
                </span>
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-ink)]"
                >
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                      {member.name}
                    </p>
                    {isCurrentUser ? (
                      <span className="rounded-[8px] bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-base)]">
                        You
                      </span>
                    ) : null}
                    <LevelBadge level={member.level} />
                  </div>
                  <p className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {member.role}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-[var(--color-primary)]">
                    {member.points}
                  </p>
                  <p className="text-[11px] text-[var(--color-ink-soft)]">
                    {member.likesReceived}{" "}
                    {member.likesReceived === 1 ? "like" : "likes"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CommunityPostCard({
  currentUser,
  post,
  memberStats,
  canModerate,
}: {
  currentUser: SkillsetUser | null;
  post: CommunityPost;
  memberStats: Map<string, MemberStats>;
  canModerate: boolean;
}) {
  const [commentsState, setCommentsState] = useState<{
    comments: CommunityComment[];
    ready: boolean;
  }>({
    comments: [],
    ready: false,
  });
  const [commentBody, setCommentBody] = useState("");
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [likeState, setLikeState] = useState<{
    count: number;
    likerIds: string[];
  }>({ count: 0, likerIds: [] });
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState("");
  const [pinPending, setPinPending] = useState(false);
  const isPinned = post.pinned === true;

  useEffect(() => {
    return subscribeToCommunityComments(
      post.id,
      (comments) => {
        setCommentsState({
          comments,
          ready: true,
        });
      },
      () => {
        setCommentError("We could not load comments for this post.");
        setCommentsState({
          comments: [],
          ready: true,
        });
      },
    );
  }, [post.id]);

  useEffect(() => {
    return subscribeToPostLikes(
      post.id,
      setLikeState,
      () => undefined,
    );
  }, [post.id]);

  const isOwnPost = currentUser?.uid === post.authorId;
  const liked = currentUser
    ? likeState.likerIds.includes(currentUser.uid)
    : false;
  const authorLevel = memberStats.get(post.authorId)?.level ?? null;

  // Comment authors aren't in the parent's post-author set, so fetch their badge
  // stats per-card and merge with the parent map. Same scoped per-uid read —
  // never a collection list.
  const commentAuthorUids = useMemo(
    () => commentsState.comments.map((comment) => comment.authorId),
    [commentsState.comments],
  );
  const commentAuthorStats = useMemberStats(commentAuthorUids);
  const threadStats = useMemo(
    () => new Map([...memberStats, ...commentAuthorStats]),
    [memberStats, commentAuthorStats],
  );

  // Thread the flat comment list into one level of nesting. A comment is a root
  // when it has no parentId (or its parent is missing); every other comment is
  // bucketed under its TOP-LEVEL ancestor (we climb the parent chain with a
  // cycle guard) so even legacy/deep replies render under a real root instead
  // of vanishing. Comments arrive sorted oldest-first, so order is preserved.
  const { rootComments, repliesByParent } = useMemo(() => {
    const byId = new Map(
      commentsState.comments.map((comment) => [comment.id, comment]),
    );
    const rootIdOf = (comment: CommunityComment): string => {
      let cursor = comment;
      let guard = 0;
      while (
        cursor.parentId
        && byId.has(cursor.parentId)
        && guard < 16
      ) {
        cursor = byId.get(cursor.parentId) as CommunityComment;
        guard += 1;
      }
      return cursor.id;
    };
    const roots: CommunityComment[] = [];
    const replies = new Map<string, CommunityComment[]>();
    for (const comment of commentsState.comments) {
      const isRoot = !comment.parentId || !byId.has(comment.parentId);
      if (isRoot) {
        roots.push(comment);
      } else {
        const rootId = rootIdOf(comment);
        const bucket = replies.get(rootId) ?? [];
        bucket.push(comment);
        replies.set(rootId, bucket);
      }
    }
    return { rootComments: roots, repliesByParent: replies };
  }, [commentsState.comments]);

  async function handleToggleLike() {
    if (!currentUser || isOwnPost || likePending) {
      return;
    }

    setLikePending(true);
    setLikeError("");
    try {
      await setCommunityPostLike(post.id, !liked, currentUser);
    } catch {
      // The like listener stays authoritative for the count, but the user
      // still deserves to know their toggle didn't land.
      setLikeError("We could not save your like. Please try again.");
    } finally {
      setLikePending(false);
    }
  }

  async function handleTogglePin() {
    if (!canModerate || pinPending) {
      return;
    }

    setPinPending(true);
    try {
      await setCommunityPostPinned(post.id, !isPinned);
      // The post listener re-sorts and re-renders pinned-first; no local state.
    } catch {
      // A failed toggle is a no-op — the rule is the authority on who may pin.
    } finally {
      setPinPending(false);
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    const nextBody = commentBody.trim();

    if (nextBody.length < 3) {
      setCommentError("Write a short comment before replying.");
      return;
    }

    setCommentError("");
    setIsCommenting(true);

    try {
      await createCommunityComment({
        postId: post.id,
        courseSlug: post.courseSlug,
        body: nextBody,
        user: currentUser,
      });
      setCommentBody("");
    } catch {
      setCommentError("We could not publish your comment.");
    } finally {
      setIsCommenting(false);
    }
  }

  return (
    <article
      className={`rounded-[14px] border p-4 ${
        isPinned
          ? "border-[var(--color-primary)] bg-[var(--color-surface-soft)]"
          : "fine-rule bg-[var(--color-surface-soft)]"
      }`}
    >
      {isPinned ? (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-primary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-base)]">
          <Pin size={11} aria-hidden />
          Pinned
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {post.authorName}
          </p>
          {authorLevel ? <LevelBadge level={authorLevel} /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canModerate ? (
            <button
              type="button"
              onClick={handleTogglePin}
              disabled={pinPending}
              aria-pressed={isPinned}
              aria-label={isPinned ? "Unpin this post" : "Pin this post"}
              className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors disabled:opacity-60 ${
                isPinned
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              <Pin size={12} aria-hidden />
              {isPinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
          <span className="rounded-[8px] bg-[var(--color-surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
            {communityPostCategoryLabels[post.category]}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
        {post.authorRole}
      </p>
      <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
        {post.body}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggleLike}
          disabled={!currentUser || isOwnPost || likePending}
          aria-pressed={liked}
          aria-label={liked ? "Remove your like" : "Like this post"}
          title={
            isOwnPost ? "You can't like your own post" : undefined
          }
          className={`inline-flex items-center gap-1.5 rounded-[8px] border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-70 ${
            liked
              ? "border-[var(--color-accent-fg)] text-[var(--color-accent-fg)]"
              : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          }`}
        >
          <Heart
            size={14}
            fill={liked ? "currentColor" : "none"}
            aria-hidden
          />
          {likeState.count}
        </button>
        {isOwnPost ? (
          <span className="text-[11px] text-[var(--color-ink-soft)]">
            Likes on your posts become points.
          </span>
        ) : null}
        {likeError ? (
          <span role="status" className="text-[11px] font-semibold text-[var(--color-accent-fg)]">
            {likeError}
          </span>
        ) : null}
      </div>

      <ReportControl
        courseSlug={post.courseSlug}
        currentUser={currentUser}
        postId={post.id}
        targetAuthorId={post.authorId}
        targetAuthorName={post.authorName}
        targetType="post"
      />

      <div className="mt-5 border-t border-[var(--color-line)] pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
          Comments
        </p>
        <div className="mt-3 grid gap-3">
          {!commentsState.ready ? (
            <p className="text-sm text-[var(--color-ink-soft)]">Loading comments...</p>
          ) : commentsState.comments.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-soft)]">
              No replies yet. Keep the discussion useful and tied to the course.
            </p>
          ) : (
            rootComments.map((rootComment) => (
              <CommentNode
                key={rootComment.id}
                rootComment={rootComment}
                replies={repliesByParent.get(rootComment.id) ?? []}
                post={post}
                currentUser={currentUser}
                memberStats={threadStats}
              />
            ))
          )}
        </div>

        <form className="mt-4 grid gap-2" onSubmit={handleCommentSubmit}>
          <textarea
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            rows={3}
            placeholder="Reply with a useful note, question, or resource."
            className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary-light)]"
          />
          {commentError ? (
            <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-fg)]">
              {commentError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isCommenting || !currentUser}
            className="button-outline justify-self-start px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isCommenting ? "Replying..." : "Reply"}
          </button>
        </form>
      </div>
    </article>
  );
}

// One root comment plus its (single level of) replies. Owns its own reply-form
// state so opening a reply on one thread never disturbs another.
function CommentNode({
  rootComment,
  replies,
  post,
  currentUser,
  memberStats,
}: {
  rootComment: CommunityComment;
  replies: CommunityComment[];
  post: CommunityPost;
  currentUser: SkillsetUser | null;
  memberStats: Map<string, MemberStats>;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  async function handleReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    const nextBody = replyBody.trim();

    if (nextBody.length < 3) {
      setReplyError("Write a short reply first.");
      return;
    }

    setReplyError("");
    setIsSubmittingReply(true);

    try {
      await createCommunityComment({
        postId: post.id,
        courseSlug: post.courseSlug,
        body: nextBody,
        user: currentUser,
        // Replies always attach to the top-level comment, keeping the thread a
        // single level deep regardless of which reply was acted on.
        parentId: rootComment.id,
      });
      setReplyBody("");
      setIsReplying(false);
    } catch {
      setReplyError("We could not publish your reply.");
    } finally {
      setIsSubmittingReply(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <CommentBody
        comment={rootComment}
        post={post}
        currentUser={currentUser}
        memberStats={memberStats}
      />

      {replies.length > 0 ? (
        <div className="mt-3 grid gap-3 border-l border-[var(--color-line)] pl-3">
          {replies.map((reply) => (
            <CommentBody
              key={reply.id}
              comment={reply}
              post={post}
              currentUser={currentUser}
              memberStats={memberStats}
            />
          ))}
        </div>
      ) : null}

      {currentUser ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setIsReplying((value) => !value)}
            className="text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            {isReplying ? "Cancel reply" : "Reply"}
          </button>
          {isReplying ? (
            <form className="mt-2 grid gap-2" onSubmit={handleReplySubmit}>
              <textarea
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                rows={2}
                placeholder={`Reply to ${rootComment.authorName}...`}
                className="resize-none rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary-light)]"
              />
              {replyError ? (
                <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)]">
                  {replyError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isSubmittingReply || !currentUser}
                className="button-outline justify-self-start px-3.5 py-2 text-xs disabled:opacity-60"
              >
                {isSubmittingReply ? "Replying..." : "Post reply"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The shared author row + body + report control, reused by a root comment and
// each of its replies.
function CommentBody({
  comment,
  post,
  currentUser,
  memberStats,
}: {
  comment: CommunityComment;
  post: CommunityPost;
  currentUser: SkillsetUser | null;
  memberStats: Map<string, MemberStats>;
}) {
  const commentLevel = memberStats.get(comment.authorId)?.level ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[var(--color-ink)]">
          {comment.authorName}
        </p>
        {commentLevel ? <LevelBadge level={commentLevel} /> : null}
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
          {comment.authorRole}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
        {comment.body}
      </p>
      <ReportControl
        commentId={comment.id}
        courseSlug={comment.courseSlug}
        currentUser={currentUser}
        postId={post.id}
        targetAuthorId={comment.authorId}
        targetAuthorName={comment.authorName}
        targetType="comment"
      />
    </div>
  );
}

function ReportControl({
  commentId = null,
  courseSlug,
  currentUser,
  postId,
  targetAuthorId,
  targetAuthorName,
  targetType,
}: {
  commentId?: string | null;
  courseSlug: string;
  currentUser: SkillsetUser | null;
  postId: string;
  targetAuthorId: string;
  targetAuthorName: string;
  targetType: CommunityReportTargetType;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<CommunityReportReason>("off_topic");
  const [detail, setDetail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    setMessage("");
    setIsSubmitting(true);

    try {
      await createCommunityReport({
        courseSlug,
        postId,
        commentId,
        targetType,
        targetAuthorId,
        targetAuthorName,
        reason,
        detail,
        user: currentUser,
      });
      setDetail("");
      setIsOpen(false);
      setMessage("Report sent to SkillsetMind trust review.");
    } catch {
      setMessage("We could not submit this report.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-accent-fg)]"
      >
        Report {targetType}
      </button>
      {message ? (
        <p className="mt-2 text-xs font-semibold text-[var(--color-ink-soft)]">
          {message}
        </p>
      ) : null}
      {isOpen ? (
        <form
          className="mt-3 grid gap-2 rounded-[14px] border border-[var(--color-line)] bg-white p-3"
          onSubmit={handleReportSubmit}
        >
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as CommunityReportReason)}
            className="rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--color-primary-light)]"
          >
            {(Object.keys(communityReportReasonLabels) as CommunityReportReason[]).map(
              (item) => (
                <option key={item} value={item}>
                  {communityReportReasonLabels[item]}
                </option>
              ),
            )}
          </select>
          <textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={2}
            placeholder="Optional context for the review team."
            className="resize-none rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--color-primary-light)]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !currentUser}
              className="button-solid px-3.5 py-2 text-xs disabled:opacity-60"
            >
              {isSubmitting ? "Sending..." : "Send report"}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="button-outline px-3.5 py-2 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
