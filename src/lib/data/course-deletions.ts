"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Modulo proprio de proposito: dezenas de testes trocam
// @/lib/data/teacher-courses por uma fabrica fechada, e um export novo la
// quebraria todos eles.

export type CourseBeingDeleted = { courseId: string; title: string; requestedAt: string };

/**
 * Produtos do professor apagados cujos arquivos e videos ainda nao sairam
 * (fila pending: a limpeza comeca um dia depois e roda de hora em hora, em
 * lotes). failed e cancelled nao aparecem. A fila e so do service role; a funcao
 * devolve so as linhas do proprio dono, e lista vazia sem o segundo fator.
 */
export async function getMyCoursesBeingDeleted(): Promise<CourseBeingDeleted[]> {
  const { data, error } = await getSupabaseBrowserClient().rpc("list_my_courses_being_deleted");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    courseId: row.course_id,
    title: row.title,
    requestedAt: row.requested_at,
  }));
}
