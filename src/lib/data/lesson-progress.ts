"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const lessonProgressTable = "lesson_progress";

export function subscribeToCompletedLessons(
  enrollmentId: string,
  callback: (lessonIds: string[]) => void,
  onError: (error: Error) => void,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // So a leitura mais nova entrega: um "Try again" que volta depois da
  // releitura de uma aula concluida agora traria o progresso velho.
  let active = true;
  let latestLoad = 0;

  const load = async () => {
    const thisLoad = ++latestLoad;
    const { data, error } = await supabase
      .from(lessonProgressTable)
      .select("lesson_id")
      .eq("enrollment_id", enrollmentId);

    if (!active || thisLoad !== latestLoad) {
      return;
    }
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map((row) => row.lesson_id).sort());
  };

  void load();

  const channel = supabase
    .channel(`lesson_progress:${enrollmentId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: lessonProgressTable,
        filter: `enrollment_id=eq.${enrollmentId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  // `reload()` le de novo SEM mexer no canal (o "Try again" da sala).
  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: load },
  );
}

export type LessonProgressResult = {
  progressPercent: number;
  status: "active" | "completed";
  completedLessonCount: number;
  totalLessonCount: number;
};

/**
 * Record (or clear) lesson completion through the server-authoritative
 * record_lesson_progress RPC (SECURITY DEFINER). The RPC validates the lesson
 * belongs to the course, writes the marker, and recomputes the enrollment's
 * progressPercent/status atomically (privileged columns via the trusted-write
 * flag). The client can no longer write progress markers or progressPercent
 * directly (both blocked by RLS + the enrollments guard), which closes the
 * certificate/refund-cap spoof.
 */
export async function recordLessonProgress(
  enrollmentId: string,
  lessonId: string,
  completed: boolean,
): Promise<LessonProgressResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("record_lesson_progress", {
    p_enrollment_id: enrollmentId,
    p_lesson_id: lessonId,
    p_completed: completed,
  });

  if (error) {
    throw error;
  }

  return data as unknown as LessonProgressResult;
}
