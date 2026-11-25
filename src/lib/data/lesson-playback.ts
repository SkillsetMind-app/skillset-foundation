"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * The data layer for `lesson_playback`: where the lesson was opened and at what
 * second the video stopped.
 *
 * READING is a direct SELECT (RLS already limits the row to the learner's own);
 * WRITING goes through the `record_lesson_playback` RPC, SECURITY DEFINER, which
 * checks whose enrollment it is and whether the lesson belongs to the course.
 * Same split as `lesson-progress.ts`: the browser never chooses the row's
 * `user_id`.
 */

/** Second saved in the database. 0 = starts from the beginning (nothing useful saved). */
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
 * Records the visit and, when `positionSeconds` is given, where the video stopped.
 *
 * A NULL `positionSeconds` has its own meaning in the database: "just record
 * that I was here", without touching the saved position. That is what OPENING
 * the lesson sends. Sending 0 there would erase the resume point of someone who
 * only reopened the lesson. An explicit zero still means "reset" (the lesson
 * ended).
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
