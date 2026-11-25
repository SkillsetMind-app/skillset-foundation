"use client";

import type { SkillsetUser } from "@/domain/auth";
import type {
  CommunityComment,
  CommunityPost,
  CommunityPostCategory,
} from "@/domain/community-post";
import type {
  CommunityReport,
  CommunityReportReason,
  CommunityReportStatus,
  CommunityReportTargetType,
} from "@/domain/community-report";
import { countOpenQuestions } from "@/domain/community-feed";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type CommunityPostRow = Database["public"]["Tables"]["community_posts"]["Row"];
type CommunityCommentRow =
  Database["public"]["Tables"]["community_comments"]["Row"];
type CommunityReportRow =
  Database["public"]["Tables"]["community_reports"]["Row"];

function nowIso(): string {
  return new Date().toISOString();
}

function rowToPost(row: CommunityPostRow): CommunityPost {
  return {
    id: row.id,
    courseSlug: row.course_slug,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    category: row.category as CommunityPostCategory,
    body: row.body,
    pinned: row.pinned ?? false,
    title: row.title ?? null,
    lessonId: row.lesson_id ?? null,
    lessonTitle: row.lesson_title ?? null,
    acceptedCommentId: row.accepted_comment_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToComment(row: CommunityCommentRow): CommunityComment {
  return {
    id: row.id,
    postId: row.post_id,
    courseSlug: row.course_slug,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReport(row: CommunityReportRow): CommunityReport {
  return {
    id: row.id,
    courseSlug: row.course_slug,
    postId: row.post_id,
    commentId: row.comment_id,
    targetType: row.target_type as CommunityReportTargetType,
    targetAuthorId: row.target_author_id,
    targetAuthorName: row.target_author_name,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    reporterEmail: row.reporter_email,
    reason: row.reason as CommunityReportReason,
    detail: row.detail,
    status: row.status as CommunityReportStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Pinned posts float above the rest; within each group newest-first. A
// query already comes in this order (so the window of 200 is the right one); sorting here
// again keeps the legacy post with a null `pinned` together with the unpinned ones.
function compareFeedPosts(left: CommunityPost, right: CommunityPost): number {
  const leftPinned = left.pinned === true ? 1 : 0;
  const rightPinned = right.pinned === true ? 1 : 0;
  if (leftPinned !== rightPinned) {
    return rightPinned - leftPinned;
  }
  const leftTs = typeof left.createdAt === "string" ? left.createdAt : "";
  const rightTs = typeof right.createdAt === "string" ? right.createdAt : "";
  return rightTs.localeCompare(leftTs);
}

export async function createCommunityPost(input: {
  courseSlug: string;
  category: CommunityPostCategory;
  body: string;
  user: SkillsetUser;
  /** The question in one line (question). Shares have no title. */
  title?: string | null;
  /** The lesson the person asked from ("from lesson 5"). */
  lessonId?: string | null;
  lessonTitle?: string | null;
}): Promise<{ id: string }> {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  // Returns the id: the teacher's inbox pins the notice right after publishing.
  const { data, error } = await supabase
    .from("community_posts")
    .insert({
      course_slug: input.courseSlug,
      author_id: input.user.uid,
      // NEVER fall back to email here. author_name is rendered to every
      // co-enrolled member of the course community, so an email fallback for a
      // learner with no displayName leaked their address as the public author
      // label. Same rule applies to the comment + report writers below.
      author_name: input.user.displayName?.trim() || "SkillsetMind member",
      author_role: input.user.roles[0] ?? "student",
      category: input.category,
      body: input.body.trim(),
      title: input.title?.trim() || null,
      lesson_id: input.lessonId ?? null,
      lesson_title: input.lessonTitle?.trim() || null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }
  return { id: data.id };
}

export function subscribeToCommunityPosts(
  courseSlug: string,
  callback: (posts: CommunityPost[]) => void,
  onError: (error: Error) => void,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // `reload()` (the "Try again") repeats this read without touching the channel. The usual
  // ones (the initial one and the channel's) deliver as before, only yielding to a newer
  // reload; what the reload started does not deliver after shutting down or on
  // top of a newer read (it would bring the feed without the new post).
  let active = true;
  let latestLoad = 0;
  let latestReload = 0;

  const load = async (fromReload = false) => {
    const thisLoad = ++latestLoad;
    if (fromReload) latestReload = thisLoad;
    // Bounded so one viral course community can't stream an unbounded
    // collection to every viewer. The window keeps the pinned ones and the NEWEST
    // (without order, the database returned any 200 and today's post could
    // disappear); it uses the index (course_slug, pinned, created_at desc). Cursor
    // pagination is the upgrade if 200 is not enough.
    const { data, error } = await supabase
      .from("community_posts")
      .select("*")
      .eq("course_slug", courseSlug)
      .order("pinned", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (fromReload ? !active || thisLoad !== latestLoad : thisLoad < latestReload) {
      return;
    }
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToPost).sort(compareFeedPosts));
  };

  void load();

  const channel = supabase
    .channel(`community_posts:course:${courseSlug}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "community_posts",
        filter: `course_slug=eq.${courseSlug}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  // `reload()` reads again WITHOUT touching the channel (the "Try again" of the feed and of
  // the lesson comments).
  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: () => load(true) },
  );
}

/** Only the NUMBER for the Community tab counter — how many of the course's questions
 *  are still without an accepted answer.
 *
 *  WHY IT DOES NOT REUSE subscribeToCommunityPosts: the counter has to exist on
 *  EVERY tab (the person is in the lesson and does not know someone answered), and opening a
 *  second realtime channel for the whole feed just to show a number is expensive.
 *  One read on opening the room, only the two columns the rule needs. The rule itself
 *  lives in the domain (countOpenQuestions), not here.
 *
 *  The database already filters (question without an accepted answer) and sends the NEWEST:
 *  without that the window of 200 took any 200 posts and the tab number
 *  came out wrong in a course with more posts. The rule stays in the domain.
 *
 *  ponytail: single read on mount, no realtime, cap of 200. If the number
 *  needs to change without reloading, the upgrade is to swap in a subscription. */
export async function countOpenCommunityQuestions(courseSlug: string): Promise<number> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("community_posts")
    .select("category, accepted_comment_id")
    .eq("course_slug", courseSlug)
    .eq("category", "question")
    .is("accepted_comment_id", null)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    throw error;
  }

  return countOpenQuestions(
    (data ?? []).map((row) => ({
      category: row.category as CommunityPostCategory,
      acceptedCommentId: row.accepted_comment_id ?? null,
    })),
  );
}

// Teacher/admin moderation: toggle a post's pinned state. The write touches only
// `pinned` + `updated_at`, which is exactly what the RLS teacher-pin path
// allows (any other changed column would be rejected). RLS refuses
// SILENTLY (0 rows), as with delete: without the count the button did not change and
// nobody found out.
export async function setCommunityPostPinned(postId: string, pinned: boolean) {
  const supabase = getSupabaseBrowserClient();

  const { error, count } = await supabase
    .from("community_posts")
    .update({ pinned, updated_at: nowIso() }, { count: "exact" })
    .eq("id", postId);

  if (error) {
    throw error;
  }
  if (!count) {
    throw new Error("community_pin_refused");
  }
}

// Deleting a post or reply: the author, the course owner or the admin (DELETE
// policies). The replies of the post (and the replies to a reply) go along in
// cascade. RLS refuses SILENTLY (0 rows, no error): without the count the screen
// would say "deleted" with the post still there.
export async function deleteCommunityPost(postId: string) {
  await deleteCommunityRow("community_posts", postId);
}

export async function deleteCommunityComment(commentId: string) {
  await deleteCommunityRow("community_comments", commentId);
}

async function deleteCommunityRow(
  table: "community_posts" | "community_comments",
  id: string,
) {
  const { error, count } = await getSupabaseBrowserClient()
    .from(table)
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    throw error;
  }
  if (!count) {
    throw new Error("community_delete_refused");
  }
}

// "Mark as the answer": the question gets the ✓ and the reply moves up into the
// card. Who can: the question's author or the course owner (UPDATE
// policies); the database refuses a comment that is not from this post (trigger).
// null desfaz.
export async function setCommunityPostAcceptedAnswer(
  postId: string,
  commentId: string | null,
) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("community_posts")
    .update({ accepted_comment_id: commentId, updated_at: nowIso() })
    .eq("id", postId);

  if (error) {
    throw error;
  }
}

export async function createCommunityComment(input: {
  postId: string;
  courseSlug: string;
  body: string;
  user: SkillsetUser;
  // null/undefined = top-level comment; a string = the top-level comment this
  // reply attaches to. Always sent explicitly so the RLS shape is satisfied.
  parentId?: string | null;
}): Promise<{ id: string }> {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  // Returns the id: "Post answer" in the teacher's inbox creates the comment and,
  // in the same gesture, marks it as THE answer.
  const { data, error } = await supabase
    .from("community_comments")
    .insert({
      post_id: input.postId,
      course_slug: input.courseSlug,
      author_id: input.user.uid,
      author_name: input.user.displayName?.trim() || "SkillsetMind member",
      author_role: input.user.roles[0] ?? "student",
      body: input.body.trim(),
      parent_id: input.parentId ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }
  return { id: data.id };
}

export function subscribeToCommunityComments(
  postId: string,
  callback: (comments: CommunityComment[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("community_comments")
      .select("*")
      .eq("post_id", postId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? []).map(rowToComment).sort((left, right) => {
        const leftTs = typeof left.createdAt === "string" ? left.createdAt : "";
        const rightTs =
          typeof right.createdAt === "string" ? right.createdAt : "";
        return leftTs.localeCompare(rightTs);
      }),
    );
  };

  void load();

  const channel = supabase
    .channel(`community_comments:post:${postId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "community_comments",
        filter: `post_id=eq.${postId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// All the comments of a course, in a single subscription. The feed needs, for
// EACH card, "View N replies" and the first reply inside the card —
// one subscription per post (the function above) would become N open channels per screen.
// The teacher's inbox also reads from here (who already answered what).
export function subscribeToCourseCommunityComments(
  courseSlug: string,
  callback: (comments: CommunityComment[]) => void,
  onError: (error: Error) => void,
  maxComments = 2000,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    // The window keeps the NEWEST replies (before it cut exactly
    // those, going past maxComments); the screen still reads from the oldest
    // to the newest.
    const { data, error } = await supabase
      .from("community_comments")
      .select("*")
      .eq("course_slug", courseSlug)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(maxComments);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToComment).reverse());
  };

  void load();

  const channel = supabase
    .channel(`community_comments:course:${courseSlug}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "community_comments",
        filter: `course_slug=eq.${courseSlug}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function createCommunityReport(input: {
  courseSlug: string;
  postId: string;
  commentId: string | null;
  targetType: CommunityReportTargetType;
  targetAuthorId: string;
  targetAuthorName: string;
  reason: CommunityReportReason;
  detail: string | null;
  user: SkillsetUser;
}) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { error } = await supabase.from("community_reports").insert({
    course_slug: input.courseSlug,
    post_id: input.postId,
    comment_id: input.commentId,
    target_type: input.targetType,
    target_author_id: input.targetAuthorId,
    target_author_name: input.targetAuthorName,
    reporter_id: input.user.uid,
    reporter_name: input.user.displayName?.trim() || "SkillsetMind member",
    reporter_email: input.user.email ?? null,
    reason: input.reason,
    detail: input.detail?.trim() || null,
    status: "open",
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) {
    throw error;
  }
}

export function subscribeToCommunityReports(
  callback: (reports: CommunityReport[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  let active = true;
  let generation = 0;

  const load = async () => {
    if (!active) return;
    const currentGeneration = ++generation;
    const { data, error } = await supabase
      .from("community_reports")
      .select("*");

    // Only the latest read may update the queue, including its error state.
    if (!active || currentGeneration !== generation) return;
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? []).map(rowToReport).sort((left, right) => {
        const leftTs = typeof left.createdAt === "string" ? left.createdAt : "";
        const rightTs =
          typeof right.createdAt === "string" ? right.createdAt : "";
        return rightTs.localeCompare(leftTs);
      }),
    );
  };

  void load();

  // No per-report filter — admin sees all reports regardless of course or status.
  // ponytail: table-wide change fan-in; acceptable for the low-volume admin moderation view.
  const channel = supabase
    .channel("community_reports:all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "community_reports" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

export async function updateCommunityReportStatus(
  report: CommunityReport,
  status: CommunityReportStatus,
) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("community_reports")
    .update({ status, updated_at: nowIso() })
    .eq("id", report.id);

  if (error) {
    throw error;
  }
}

/**
 * The most recent questions from SEVERAL courses, in a single read.
 *
 * ponytail: single read, no realtime, same reason as
 * getRecentCourseReviews — Home does not open a channel per course just to list
 * what happened. `course_slug` is the course id (see TeacherCommunityInbox).
 */
export async function getRecentCommunityQuestions(
  courseSlugs: string[],
  limit = 10,
): Promise<CommunityPost[]> {
  if (!courseSlugs.length) {
    return [];
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("community_posts")
    .select("*")
    .in("course_slug", courseSlugs)
    .eq("category", "question")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(rowToPost);
}

/**
 * The ids of the questions waiting for the teacher in their communities: the
 * same rule as each course's inbox (openQuestions) — no accepted answer and
 * no instructor reply. It feeds the number next to "Inbox" on every
 * teacher page, so it reads only ids, never the text.
 *
 * NEWEST first, with the filters in the query: the window used to take the 200
 * oldest, and questions already answered but without an "accepted answer" filled the
 * window until the Inbox said "nothing waiting" with a learner waiting. Of the
 * replies, the database returns only the instructor ones, and only the post_id column.
 *
 * ponytail: two reads, caps of 200 questions and 2000 replies. An
 * open question older than the 200 newest without an accepted answer is left
 * out; the upgrade is an RPC that filters "no instructor reply" in the database.
 */
export async function getOpenCommunityQuestions(
  courseSlugs: string[],
  instructorId: string,
): Promise<string[]> {
  if (!courseSlugs.length) {
    return [];
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("community_posts")
    .select("id")
    .in("course_slug", courseSlugs)
    .eq("category", "question")
    .is("accepted_comment_id", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  const ids = (data ?? []).map((post) => post.id);
  if (!ids.length) {
    return [];
  }

  // The same rule as isInstructor (community-feed): teacher or
  // admin role, or the course owner.
  const { data: replies, error: repliesError } = await supabase
    .from("community_comments")
    .select("post_id")
    .in("post_id", ids)
    .or(`author_role.in.(teacher,admin),author_id.eq.${instructorId}`)
    .limit(2000);

  if (repliesError) throw repliesError;
  const answered = new Set((replies ?? []).map((reply) => reply.post_id));
  return ids.filter((id) => !answered.has(id));
}

/** The text of the questions the Inbox lists, from the one that has waited longest
 *  to the newest. Only the Inbox page reads this; the count does not need it. */
export async function getCommunityPostsByIds(ids: string[]): Promise<CommunityPost[]> {
  if (!ids.length) {
    return [];
  }

  const { data, error } = await getSupabaseBrowserClient()
    .from("community_posts")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(rowToPost);
}
