"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * A camada de dados de `lesson_playback`: onde a aula foi aberta e em que
 * segundo o video parou.
 *
 * A LEITURA e SELECT direto (a RLS ja limita a linha do proprio aluno); a
 * ESCRITA e pela RPC `record_lesson_playback`, SECURITY DEFINER, que confere de
 * quem e a matricula e se a aula pertence ao curso. Mesma divisao de
 * `lesson-progress.ts`: o navegador nunca escolhe o `user_id` da linha.
 */

/** Segundo guardado no banco. 0 = comeca do inicio (nada util guardado). */
export async function fetchLessonPosition(
  enrollmentId: string,
  lessonId: string,
): Promise<number> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("lesson_playback")
    .select("position_seconds")
    .eq("enrollment_id", enrollmentId)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const seconds = Number(data?.position_seconds);

  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/**
 * Registra a visita e, quando `positionSeconds` vem, onde o video parou.
 *
 * `positionSeconds` NULO tem significado proprio no banco: "so registra que
 * estive aqui", sem tocar a posicao guardada. E o que a ABERTURA da aula manda
 * — mandar 0 ali apagaria o ponto de retomada de quem so reabriu a aula. Zero
 * explicito continua sendo "zera" (a aula terminou).
 */
export async function recordLessonPlayback(
  enrollmentId: string,
  lessonId: string,
  positionSeconds: number | null,
  durationSeconds?: number | null,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("record_lesson_playback", {
    p_enrollment_id: enrollmentId,
    p_lesson_id: lessonId,
    p_position_seconds: positionSeconds,
    p_duration_seconds:
      typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
        ? Math.floor(durationSeconds)
        : null,
  });

  if (error) {
    throw error;
  }
}
