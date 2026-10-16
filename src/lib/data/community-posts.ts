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
// consulta ja vem nessa ordem (para a janela de 200 ser a certa); ordenar aqui
// de novo mantem o post legado com `pinned` nulo junto dos nao fixados.
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
    // collection to every viewer. A janela fica com os fixados e os MAIS
    // NOVOS (sem order, o banco devolvia 200 quaisquer e o post de hoje podia
    // sumir); usa o indice (course_slug, pinned, created_at desc). A pagina
    // por cursor e o upgrade se 200 nao bastar.
    const { data, error } = await supabase
      .from("community_posts")
      .select("*")
      .eq("course_slug", courseSlug)
      .order("pinned", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
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

/** So o NUMERO para o contador da aba Community — quantas perguntas do curso
 *  seguem sem resposta aceita.
 *
 *  POR QUE NAO REUSA subscribeToCommunityPosts: o contador precisa existir em
 *  TODA aba (a pessoa esta na aula e nao sabe que responderam), e abrir um
 *  segundo canal realtime do feed inteiro so para mostrar um numero e caro.
 *  Uma leitura ao abrir a sala, so as duas colunas da regra. A regra em si
 *  mora no dominio (countOpenQuestions), nao aqui.
 *
 *  O banco ja filtra (pergunta sem resposta aceita) e manda as MAIS NOVAS:
 *  sem isso a janela de 200 pegava 200 posts quaisquer e o numero da aba
 *  saia errado num curso com mais posts. A regra continua no dominio.
 *
 *  ponytail: leitura unica na montagem, sem realtime, teto de 200. Se o numero
 *  precisar mudar sem recarregar, o upgrade e trocar por uma inscricao. */
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
// allows (any other changed column would be rejected). A RLS recusa em
// SILENCIO (0 linhas), como no apagar: sem o count o botao nao mudava e
// ninguem ficava sabendo.
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

// Apagar post ou resposta: o autor, o dono do curso ou o admin (policies de
// DELETE). As respostas do post (e as respostas de uma resposta) vao junto em
// cascata. A RLS recusa em SILENCIO (0 linhas, sem erro): sem o count a tela
// diria "apagado" com o post ainda la.
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
    // A janela guarda as respostas MAIS NOVAS (antes cortava justamente
    // elas, passando de maxComments); a tela continua lendo da mais antiga
    // para a mais nova.
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
 * As perguntas mais recentes de VÁRIOS cursos, numa única leitura.
 *
 * ponytail: leitura única, sem realtime, mesmo motivo de
 * getRecentCourseReviews — a Home não abre um canal por curso só para listar
 * o que aconteceu. `course_slug` é o id do curso (ver TeacherCommunityInbox).
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
 * Os ids das perguntas que esperam pelo professor nas comunidades dele: a
 * mesma regra da caixa de cada curso (openQuestions) — sem resposta aceita e
 * sem resposta de instrutor. Alimenta o numero ao lado de "Inbox" em toda
 * pagina do professor, entao le so ids, nunca o texto.
 *
 * As mais NOVAS primeiro, com os filtros na consulta: a janela pegava as 200
 * mais antigas, e perguntas ja respondidas sem "resposta aceita" ocupavam a
 * janela ate a Caixa dizer "nada esperando" com aluno esperando. Das
 * respostas, o banco devolve so as de instrutor, e so a coluna post_id.
 *
 * ponytail: duas leituras, tetos de 200 perguntas e 2000 respostas. Uma
 * pergunta aberta mais velha que as 200 mais novas sem resposta aceita fica de
 * fora; o upgrade e uma RPC que filtre "sem resposta de instrutor" no banco.
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

  // A mesma regra de isInstructor (community-feed): papel de professor ou
  // admin, ou o dono do curso.
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

/** O texto das perguntas que a Caixa de entrada lista, da que espera ha mais
 *  tempo para a mais nova. So a pagina Inbox le isto; a conta nao precisa. */
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
