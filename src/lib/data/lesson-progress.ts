"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const lessonProgressTable = "lesson_progress";

export function subscribeToCompletedLessons(
  enrollmentId: string,
  callback: (lessonIds: string[]) => void,
  onError: (error: Error) => void,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // `reload()` (the "Try again") repeats this read without touching the channel.
  // The usual ones (the initial one and the channel's) deliver as before and only
  // yield to a newer reload; what the reload started does not deliver after the
  // channel is turned off, nor over a newer read (it would bring the stale
  // progress).
  let active = true;
  let latestLoad = 0;
  let latestReload = 0;

  const load = async (fromReload = false) => {
    const thisLoad = ++latestLoad;
    if (fromReload) latestReload = thisLoad;
    const { data, error } = await supabase
      .from(lessonProgressTable)
      .select("lesson_id")
      .eq("enrollment_id", enrollmentId);

    if (fromReload ? !active || thisLoad !== latestLoad : thisLoad < latestReload) {
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

  // `reload()` reads again WITHOUT touching the channel (the room's "Try again").
  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: () => load(true) },
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
