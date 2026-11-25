import type { CommunityComment, CommunityPost } from "@/domain/community-post";

// The simplified community (mockup 5, wave 11): one feed, three filters,
// two actions. This file is the PURE part: what a question is, what is
// "answered", which answer shows inside the card, what the teacher
// has waiting. The screens only read from here; that is why everything can be proven without
// rendering anything.

/** What the person does: asks, shares, or (instructor) publishes a notice.
 *  Mapped onto the `category` column that already existed, with no new column. */
export type CommunityPostKind = "question" | "share" | "update";

export type CommunityFeedFilter = "all" | "questions" | "instructor";

export function postKind(post: Pick<CommunityPost, "category">): CommunityPostKind {
  if (post.category === "question") {
    return "question";
  }
  if (post.category === "announcement") {
    return "update";
  }
  return "share";
}

/** Instructor = whoever wrote with a teacher/admin role, or the owner of the course. */
export function isInstructor(
  author: Pick<CommunityPost, "authorId" | "authorRole">,
  instructorIds: ReadonlySet<string> | string[] = [],
): boolean {
  const ids = instructorIds instanceof Set ? instructorIds : new Set(instructorIds);
  return (
    author.authorRole === "teacher"
    || author.authorRole === "admin"
    || ids.has(author.authorId)
  );
}

export function isAnswered(post: Pick<CommunityPost, "category" | "acceptedCommentId">): boolean {
  return post.category === "question" && Boolean(post.acceptedCommentId);
}

/** Three filters in place of six spaces with sorting. Pinned always on top. */
export function filterPosts(
  posts: CommunityPost[],
  filter: CommunityFeedFilter,
  instructorIds: ReadonlySet<string> | string[] = [],
  query = "",
): CommunityPost[] {
  const needle = query.trim().toLowerCase();
  const ids = instructorIds instanceof Set ? instructorIds : new Set(instructorIds);

  const kept = posts.filter((post) => {
    if (filter === "questions" && postKind(post) !== "question") {
      return false;
    }
    if (filter === "instructor" && !isInstructor(post, ids)) {
      return false;
    }
    if (needle) {
      const haystack = `${post.title ?? ""} ${post.body}`.toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }
    return true;
  });

  return [...kept].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return toMillis(b.createdAt) - toMillis(a.createdAt);
  });
}

/** Accepts anything with the two columns of the rule: the tab counter
 *  Community reads only `category` and `accepted_comment_id`, without bringing the post
 *  entire post from the database. */
export function countOpenQuestions(
  posts: Pick<CommunityPost, "category" | "acceptedCommentId">[],
): number {
  return posts.filter((post) => postKind(post) === "question" && !isAnswered(post)).length;
}

/** Top-level comments per post (do replies to replies stay out
 *  of the "View N replies" count? No: they all count, and it is the number the person
 *  sees when they open it). */
export function groupCommentsByPost(
  comments: CommunityComment[],
): Map<string, CommunityComment[]> {
  const byPost = new Map<string, CommunityComment[]>();
  for (const comment of comments) {
    const list = byPost.get(comment.postId) ?? [];
    list.push(comment);
    byPost.set(comment.postId, list);
  }
  for (const list of byPost.values()) {
    list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  }
  return byPost;
}

/** The answer shown INSIDE the card: the accepted one; otherwise, the instructor's;
 *  otherwise, the first top-level one. */
export function pickInlineReply(
  post: Pick<CommunityPost, "id" | "acceptedCommentId">,
  comments: CommunityComment[],
  instructorIds: ReadonlySet<string> | string[] = [],
): CommunityComment | null {
  const own = comments.filter((c) => c.postId === post.id);
  if (own.length === 0) {
    return null;
  }
  const accepted = post.acceptedCommentId
    ? own.find((c) => c.id === post.acceptedCommentId)
    : undefined;
  if (accepted) {
    return accepted;
  }
  const fromInstructor = own.find((c) => !c.parentId && isInstructor(c, instructorIds));
  if (fromInstructor) {
    return fromInstructor;
  }
  return own.find((c) => !c.parentId) ?? own[0];
}

/** While the person types the question, similar questions that are ALREADY ANSWERED.
 *  Half of the doubts get solved without posting. Criterion: at least two
 *  words of 4+ letters in common with the title. */
export function findSimilarAnswered(
  query: string,
  posts: CommunityPost[],
  limit = 3,
): CommunityPost[] {
  const words = tokens(query);
  if (words.size < 2) {
    return [];
  }
  return posts
    .filter((post) => isAnswered(post) && post.title)
    .map((post) => {
      const overlap = [...tokens(`${post.title} ${post.body}`)].filter((w) => words.has(w)).length;
      return { post, overlap };
    })
    .filter(({ overlap }) => overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map(({ post }) => post);
}

/** For the teacher: open questions, with no accepted answer and no answer
 *  from the instructor, from the oldest to the newest. */
export function openQuestions(
  posts: CommunityPost[],
  comments: CommunityComment[],
  instructorIds: ReadonlySet<string> | string[] = [],
): CommunityPost[] {
  const ids = instructorIds instanceof Set ? instructorIds : new Set(instructorIds);
  const byPost = groupCommentsByPost(comments);
  return posts
    .filter((post) => postKind(post) === "question" && !isAnswered(post))
    .filter((post) => !(byPost.get(post.id) ?? []).some((c) => isInstructor(c, ids)))
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

/** "waiting 2 days": and red after 24 h. */
export function waitingFor(
  post: Pick<CommunityPost, "createdAt">,
  now = Date.now(),
): { label: string; overdue: boolean } {
  const ms = Math.max(0, now - toMillis(post.createdAt));
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    return { label: `waiting ${minutes} min`, overdue: false };
  }
  if (hours < 24) {
    return { label: `waiting ${hours} hour${hours === 1 ? "" : "s"}`, overdue: false };
  }
  const days = Math.floor(hours / 24);
  return { label: `waiting ${days} day${days === 1 ? "" : "s"}`, overdue: true };
}

/** "This week": posts, questions, shares and who took part. */
export function weekSummary(
  posts: CommunityPost[],
  comments: CommunityComment[],
  now = Date.now(),
): { posts: number; questions: number; shares: number; activeMembers: number } {
  const since = now - 7 * 24 * 3_600_000;
  const recentPosts = posts.filter((p) => toMillis(p.createdAt) >= since);
  const recentComments = comments.filter((c) => toMillis(c.createdAt) >= since);
  const people = new Set([
    ...recentPosts.map((p) => p.authorId),
    ...recentComments.map((c) => c.authorId),
  ]);
  return {
    posts: recentPosts.length,
    questions: recentPosts.filter((p) => postKind(p) === "question").length,
    shares: recentPosts.filter((p) => postKind(p) === "share").length,
    activeMembers: people.size,
  };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  );
}

/** createdAt comes from Supabase as ISO; old rows may bring
 *  { seconds }. No date = 0 (goes to the end). */
export function toMillis(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value && typeof value === "object" && "seconds" in value) {
    const seconds = (value as { seconds?: unknown }).seconds;
    return typeof seconds === "number" ? seconds * 1000 : 0;
  }
  return 0;
}

/** Removes from the screen what the person just deleted, without waiting for realtime (the
 *  DELETE does not arrive through the channel filtered by course). Like the database cascade,
 *  the replies of a deleted post and of a deleted reply disappear along with it. */
export function withoutDeleted<T extends { id: string; postId?: string; parentId?: string | null }>(
  items: T[],
  deleted: ReadonlySet<string>,
): T[] {
  if (deleted.size === 0) return items;
  return items.filter(
    (item) =>
      !deleted.has(item.id)
      && !(item.postId && deleted.has(item.postId))
      && !(item.parentId && deleted.has(item.parentId)),
  );
}
