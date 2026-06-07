"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Heart } from "lucide-react";

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
  subscribeToCommunityComments,
  subscribeToCommunityPosts,
} from "@/lib/data/community-posts";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import {
  setCommunityPostLike,
  subscribeToMemberStatsMap,
  subscribeToPostLikes,
} from "@/lib/data/gamification";

type CourseCommunityFeedProps = {
  space: CommunitySpace;
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

export function CourseCommunityFeed({ space }: CourseCommunityFeedProps) {
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
  const [memberStats, setMemberStats] = useState<Map<string, MemberStats>>(
    () => new Map(),
  );

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
    if (!user) {
      return;
    }

    // One collection listener feeds every level badge in the feed + leaderboard
    // (memberStats docs are tiny). A read failure leaves badges absent, never
    // breaks the feed.
    return subscribeToMemberStatsMap(setMemberStats, () => undefined);
  }, [user]);

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
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
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
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
          {space.name}
        </p>
        <h3 className="display-title mt-3 text-4xl text-[var(--color-ink)]">
          Course community
        </h3>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {space.description}
        </p>
        <div className="mt-5 flex flex-wrap gap-2 rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-2">
          {communityTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-[9px] px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-ink-soft)] hover:bg-white hover:text-[var(--color-ink)]"
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
                className="min-h-[72px] resize-none rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm outline-none transition focus:border-[var(--color-primary-light)] focus:bg-white"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="button-solid px-4 py-3 text-sm disabled:opacity-60"
              >
                {isSubmitting ? "Publishing..." : "Post"}
              </button>
            </div>
            {error ? (
              <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent)]">
                {error}
              </p>
            ) : null}
          </form>
          <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
              Feed
            </p>
            <div className="mt-5 grid gap-4">
              {!postsState.ready || postsState.key !== space.courseSlug ? (
                <p className="text-sm text-[var(--color-ink-soft)]">Loading community feed...</p>
              ) : postsState.posts.length === 0 ? (
                <p className="rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
                  No posts yet. The first discussion can set the tone for this course space.
                </p>
              ) : (
                postsState.posts.map((post) => (
                  <CommunityPostCard
                    key={post.id}
                    currentUser={user}
                    post={post}
                    memberStats={memberStats}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "leaderboard" ? (
        <CommunityLeaderboard
          currentUserId={user?.uid ?? null}
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
        <CommunityInfoPanel
          title="Members"
          items={[
            ["Your role", user?.roles.includes("teacher") ? "Teacher or educator" : "Learner"],
            ["Access model", "Only enrolled learners, course teachers, and approved operations users can participate."],
            ["Directory", "A richer member directory comes after notifications and profile privacy settings."],
          ]}
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
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
        Course community
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h3>
      <div className="mt-5 grid gap-3">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              {label}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
              {value}
            </p>
          </div>
        ))}
      </div>
      {cta ? (
        <Link href={cta.href} className="button-solid mt-6 inline-flex px-5 py-3 text-sm">
          {cta.label}
        </Link>
      ) : null}
    </section>
  );
}

function CommunityPostCard({
  currentUser,
  post,
  memberStats,
}: {
  currentUser: SkillsetUser | null;
  post: CommunityPost;
  memberStats: Map<string, MemberStats>;
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

  async function handleToggleLike() {
    if (!currentUser || isOwnPost || likePending) {
      return;
    }

    setLikePending(true);
    try {
      await setCommunityPostLike(post.id, !liked, currentUser);
    } catch {
      // The like listener stays authoritative; a failed toggle is a no-op.
    } finally {
      setLikePending(false);
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
    <article className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {post.authorName}
          </p>
          {authorLevel ? <LevelBadge level={authorLevel} /> : null}
        </div>
        <span className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
          {communityPostCategoryLabels[post.category]}
        </span>
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
          className={`inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-70 ${
            liked
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
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
            commentsState.comments.map((comment) => {
              const commentLevel =
                memberStats.get(comment.authorId)?.level ?? null;
              return (
                <div
                  key={comment.id}
                  className="rounded-[3px] border border-[var(--color-line)] bg-white p-3"
                >
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
            })
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
            <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent)]">
              {commentError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isCommenting || !currentUser}
            className="button-outline justify-self-start px-4 py-2 text-sm disabled:opacity-60"
          >
            {isCommenting ? "Replying..." : "Reply"}
          </button>
        </form>
      </div>
    </article>
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
      setMessage("Report sent to Skillset trust review.");
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
        className="text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-accent)]"
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
          className="mt-3 grid gap-2 rounded-[3px] border border-[var(--color-line)] bg-white p-3"
          onSubmit={handleReportSubmit}
        >
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as CommunityReportReason)}
            className="rounded-[9px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--color-primary-light)]"
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
            className="resize-none rounded-[9px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--color-primary-light)]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !currentUser}
              className="button-solid px-3 py-2 text-xs disabled:opacity-60"
            >
              {isSubmitting ? "Sending..." : "Send report"}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="button-outline px-3 py-2 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
