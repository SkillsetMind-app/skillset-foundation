import { isAuthSessionMissingError } from "@supabase/supabase-js";

import { hasPermission, isRole, type Role } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server-only (o segmento `/server/` é o marcador deste repo, como em
// src/lib/payments/server e src/lib/learn/server).
//
// POR QUE ESTE MÓDULO EXISTE
//
// src/lib/data/published-courses.ts começa com "use client", então nada dele
// pode ser importado de um Server Component — nem o mapper de linha, nem
// `courseUrlSlug`. Era o motivo de a página de curso não conseguir resolver um
// curso de criador no servidor e cair no metadata literal "Course", igual para
// todos: colar o link de qualquer curso no WhatsApp gerava o mesmo card, sem
// título, sem descrição e sem imagem.
//
// A leitura anônima serve aqui e não precisa de service_role: a policy
// `courses_select_public` libera `status IN ('published','in_review')` para
// `{public}`, e o EXECUTE dos predicados foi devolvido ao anon em
// 20260901120000 — antes disso toda leitura anônima abortava com 42501, que é
// exatamente por que esta abordagem não era possível até hoje.

/** Só o que a página pública e o card de compartilhamento precisam. */
export type PublicCourseSummary = {
  id: string;
  urlSlug: string;
  title: string;
  summary: string | null;
  category: string | null;
  coverImageUrl: string | null;
  lessonCount: number | null;
  updatedAt: string | null;
};

const PUBLIC_FIELDS =
  "id, title, title_key, slug, summary, category, cover_image_url, lesson_count, status, updated_at";

type CourseRow = {
  id: string;
  title: string | null;
  title_key: string | null;
  slug: string | null;
  summary: string | null;
  category: string | null;
  cover_image_url: string | null;
  lesson_count: number | null;
  status: string | null;
  updated_at: string | null;
};

/**
 * A URL pública de um curso é o `title_key`, com queda para `id` em linhas
 * antigas — espelha `courseUrlSlug` de published-courses.ts. Duplicado de
 * propósito: importar de lá arrastaria o "use client" para o servidor.
 */
function publicUrlSlug(row: CourseRow): string {
  return row.title_key || row.slug || row.id;
}

function toSummary(row: CourseRow): PublicCourseSummary {
  return {
    id: row.id,
    urlSlug: publicUrlSlug(row),
    title: row.title ?? "Course",
    summary: row.summary,
    category: row.category,
    coverImageUrl: row.cover_image_url,
    lessonCount: row.lesson_count,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolve um curso publicado por id OU title_key, na mesma ordem que o cliente
 * usa (published-courses.ts:209-228) — se as duas pontas divergirem, o metadata
 * descreve um curso e o corpo mostra outro.
 *
 * Só `published`: a policy também libera `in_review`, mas curso em revisão não
 * está à venda e não deve ganhar página pública nem entrar no sitemap.
 */
export async function getPublicCourseByRef(
  ref: string,
): Promise<PublicCourseSummary | null> {
  try {
    const supabase = await createSupabaseServerClient();

    const byId = await supabase
      .from("courses")
      .select(PUBLIC_FIELDS)
      .eq("id", ref)
      .eq("status", "published")
      .maybeSingle();

    if (byId.data) return toSummary(byId.data as CourseRow);

    const byKey = await supabase
      .from("courses")
      .select(PUBLIC_FIELDS)
      .eq("title_key", ref)
      .eq("status", "published")
      .limit(1);

    const row = byKey.data?.[0];
    return row ? toSummary(row as CourseRow) : null;
  } catch {
    // A página tem caminho de fallback (o client component continua buscando),
    // então uma falha de leitura aqui degrada o metadata — nunca derruba a rota.
    return null;
  }
}

export type CourseRefAccess = "visible" | "missing" | "unknown";

const ACCESS_FIELDS = "id, status, owner_id";

type AccessRow = { id: string; status: string | null; owner_id: string | null };

/**
 * O que a página /courses/[ref] faz com um ref que não é do catálogo estático
 * nem curso publicado encontrado.
 *
 * A leitura usa o cliente da SESSÃO do pedido, então a RLS decide o que existe
 * para quem pede: o dono (courses_select_owner), o admin aal2
 * (courses_select_admin) e o aluno matriculado (courses_select_enrolled) leem
 * rascunho e arquivado; o público só lê publicado e em revisão
 * (courses_select_public). Como "em revisão" é legível por qualquer um, ali
 * exige-se ser o dono ou o admin.
 *
 * - "visible": renderiza (prévia do dono/admin, ou curso publicado).
 * - "missing": 404 de verdade.
 * - "unknown": a leitura falhou; quem chama NÃO deve responder 404 — um
 *   soluço do banco não pode derrubar a página de um curso publicado.
 */
export async function getCourseRefAccess(ref: string): Promise<CourseRefAccess> {
  try {
    const supabase = await createSupabaseServerClient();

    // courses.id é TEXT: um title_key não faz esta busca falhar, só não acha
    // nada. Erro aqui é falha de verdade — e seguir para o title_key, vazio nos
    // links que levam o id cru (cancel_url do Stripe, "ver página pública",
    // perfil do professor), daria 404 num curso no ar.
    const byId = await supabase
      .from("courses")
      .select(ACCESS_FIELDS)
      .eq("id", ref)
      .maybeSingle();
    if (byId.error) return "unknown";
    let row = (byId.data as AccessRow | null) ?? null;

    if (!row) {
      const byKey = await supabase
        .from("courses")
        .select(ACCESS_FIELDS)
        .eq("title_key", ref)
        .limit(1);
      if (byKey.error) return "unknown";
      row = (byKey.data?.[0] as AccessRow | undefined) ?? null;
    }

    if (!row) {
      // Sessão revogada (conta suspensa e restaurada, convite aceito): o GoTrue
      // ainda aceita o JWT, mas a policy restritiva account_access_guard esconde
      // TODA linha dela, curso publicado inclusive. Não achar ali não é "não
      // existe". Sem sessão no cookie, getUser responde sem ir à rede.
      const { error: userError } = await supabase.auth.getUser();
      return userError?.code === "account_access_denied" ? "unknown" : "missing";
    }
    if (row.status === "published") return "visible";
    // courses_select_public só expõe published e in_review. Rascunho,
    // needs_changes ou inactive que voltou é a RLS autorizando ESTE leitor
    // (dono, admin aal2 ou aluno matriculado) — não depende de getUser, que
    // pode falhar com o JWT ainda válido.
    if (row.status !== "in_review") return "visible";

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (!user) {
      // Sem sessão, ou sessão devendo o segundo fator: visitante anônimo.
      // Qualquer outra falha do Auth não é resposta e não vira 404.
      const anonymous = !userError
        || isAuthSessionMissingError(userError)
        || userError.code === "mfa_required";
      return anonymous ? "missing" : "unknown";
    }
    if (row.owner_id === user.id) return "visible";

    // Mesmo teste do cliente (creator-course-detail: hasPermission(roles,
    // "platform.accessAdmin")), com os papéis do perfil da sessão. Papel
    // operacional só vale em sessão aal2 (20260912010000).
    const profile = await supabase.from("users").select("roles").eq("uid", user.id).maybeSingle();
    if (profile.error) return "unknown";
    const roles = Array.isArray(profile.data?.roles)
      ? profile.data.roles.filter((role): role is Role => typeof role === "string" && isRole(role))
      : [];
    if (!hasPermission({ roles }, "platform.accessAdmin")) return "missing";
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) return "unknown";
    return assurance.data.currentLevel === "aal2" ? "visible" : "missing";
  } catch {
    return "unknown";
  }
}

/** Cursos publicados para o sitemap. */
export async function listPublishedCourses(): Promise<PublicCourseSummary[]> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data } = await supabase
      .from("courses")
      .select(PUBLIC_FIELDS)
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(1000);

    return (data ?? []).map((row) => toSummary(row as CourseRow));
  } catch {
    return [];
  }
}
