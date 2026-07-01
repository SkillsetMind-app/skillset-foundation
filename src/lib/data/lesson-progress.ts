"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const lessonProgressTable = "lesson_progress";

export function subscribeToCompletedLessons(
  enrollmentId: string,
  callback: (lessonIds: string[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(lessonProgressTable)
      .select("lesson_id")
      .eq("enrollment_id", enrollmentId);

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

  return () => {
    void supabase.removeChannel(channel);
  };
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
