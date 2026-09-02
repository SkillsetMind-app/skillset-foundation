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

// Pinned posts float above the rest; within each group newest-first. Sorting
// client-side keeps the query a single course_slug filter (no composite index)
// and stays correct for legacy posts that predate the `pinned` field.
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
  /** A pergunta em uma linha (question). Compartilhamentos nao tem titulo. */
  title?: string | null;
  /** A aula de onde a pessoa perguntou ("from lesson 5"). */
  lessonId?: string | null;
  lessonTitle?: string | null;
}): Promise<{ id: string }> {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  // Devolve o id: a caixa do professor fixa o aviso logo depois de publicar.
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
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    // Bounded so one viral course community can't stream an unbounded
    // collection to every viewer. Truncation past the cap is arbitrary; a
    // cursor-based pagination path is the scale-up upgrade.
    const { data, error } = await supabase
      .from("community_posts")
      .select("*")
      .eq("course_slug", courseSlug)
      .limit(200);

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

  return () => {
    void supabase.removeChannel(channel);
  };
}

// Teacher/admin moderation: toggle a post's pinned state. The write touches only
// `pinned` + `updated_at`, which is exactly what the RLS teacher-pin path
// allows (any other changed column would be rejected).
export async function setCommunityPostPinned(postId: string, pinned: boolean) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("community_posts")
    .update({ pinned, updated_at: nowIso() })
    .eq("id", postId);

  if (error) {
    throw error;
  }
}

// "Mark as the answer": a pergunta ganha o ✓ e a resposta sobe para dentro do
// cartao. Quem pode: o autor da pergunta ou o dono do curso (policies de
// UPDATE); o banco recusa um comentario que nao seja deste post (trigger).
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

  // Devolve o id: "Post answer" na caixa do professor cria o comentario e,
  // no mesmo gesto, marca-o como A resposta.
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

// Todos os comentarios de um curso, numa inscricao so. O feed precisa, para
// CADA cartao, de "View N replies" e da primeira resposta dentro do cartao —
// uma inscricao por post (a funcao acima) viraria N canais abertos por tela.
// A caixa do professor tambem le daqui (quem ja respondeu o que).
export function subscribeToCourseCommunityComments(
  courseSlug: string,
  callback: (comments: CommunityComment[]) => void,
  onError: (error: Error) => void,
  maxComments = 2000,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("community_comments")
      .select("*")
      .eq("course_slug", courseSlug)
      .order("created_at", { ascending: true })
      .limit(maxComments);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToComment));
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

  const load = async () => {
    const { data, error } = await supabase
      .from("community_reports")
      .select("*");

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
