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
