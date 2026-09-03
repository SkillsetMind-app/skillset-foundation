import type { CommunityComment, CommunityPost } from "@/domain/community-post";

// A comunidade simplificada (mockup 5, rodada 11): um feed, tres filtros,
// duas acoes. Este arquivo e a parte PURA — o que e pergunta, o que e
// "respondida", qual resposta aparece dentro do cartao, o que o professor
// tem esperando. As telas so leem daqui; por isso da para provar tudo sem
// renderizar nada.

/** O que a pessoa faz: pergunta, compartilha, ou (instrutor) publica um aviso.
 *  Mapeado sobre a coluna `category` que ja existia — sem coluna nova. */
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

export function categoryForKind(kind: CommunityPostKind): CommunityPost["category"] {
  return kind === "question" ? "question" : kind === "update" ? "announcement" : "discussion";
}

/** Instrutor = quem escreveu com papel de professor/admin, ou o dono do curso. */
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

/** Tres filtros no lugar de seis espacos com ordenacao. Pinned sempre no topo. */
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

/** Aceita qualquer coisa com as duas colunas da regra: o contador da aba
 *  Community le so `category` e `accepted_comment_id`, sem trazer o post
 *  inteiro do banco. */
export function countOpenQuestions(
  posts: Pick<CommunityPost, "category" | "acceptedCommentId">[],
): number {
  return posts.filter((post) => postKind(post) === "question" && !isAnswered(post)).length;
}

/** Comentarios de nivel superior por post (respostas a respostas ficam de fora
 *  da contagem "View N replies"? Nao: contam todos — e o numero que a pessoa
 *  ve ao abrir). */
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

/** A resposta que aparece DENTRO do cartao: a aceita; senao, a do instrutor;
 *  senao, a primeira de nivel superior. */
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

/** Enquanto a pessoa digita a pergunta, perguntas parecidas JA RESPONDIDAS.
 *  Metade das duvidas se resolve sem postar. Criterio: pelo menos duas
 *  palavras de 4+ letras em comum com o titulo. */
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

/** Para o professor: perguntas em aberto — sem resposta aceita e sem resposta
 *  do instrutor — da mais antiga para a mais nova. */
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

/** "waiting 2 days" — e vermelho depois de 24 h. */
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

/** "This week": posts, perguntas, compartilhamentos e quem participou. */
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

/** createdAt vem do Supabase como ISO; linhas antigas podem trazer
 *  { seconds }. Sem data = 0 (vai para o fim). */
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
