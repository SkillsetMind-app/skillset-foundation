"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// A module of its own on purpose: dozens of tests swap
// @/lib/data/teacher-courses for a closed factory, and a new export there
// would break all of them.

export type CourseBeingDeleted = { courseId: string; title: string; requestedAt: string };

/**
 * Teacher's deleted products whose files and videos have not yet gone
 * (pending queue: the cleanup starts a day later and runs hourly, in
 * batches). failed and cancelled do not appear. The queue is service role only; the function
 * returns only the rows of its own owner, and an empty list without the second factor.
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
