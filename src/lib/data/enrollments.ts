"use client";

import {
  createEnrollmentSnapshot,
  getEnrollmentId,
  type Enrollment,
  type EnrollmentSource,
  type EnrollmentStatus,
} from "@/domain/enrollment";
import type { Course } from "@/domain/learning";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type EnrollmentRow = Database["public"]["Tables"]["enrollments"]["Row"];

function nowIso(): string {
  return new Date().toISOString();
}

function rowToEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseTitle: row.course_title,
    courseCategory: row.course_category,
    courseImage: row.course_image,
    status: row.status as EnrollmentStatus,
    source: row.source as EnrollmentSource,
    subscriptionId: row.subscription_id,
    progressPercent: row.progress_percent,
    lastLessonId: row.last_lesson_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function byCourseTitle(left: Enrollment, right: Enrollment): number {
  return left.courseTitle.localeCompare(right.courseTitle);
}

export async function createManualEnrollment(userId: string, course: Course) {
  const supabase = getSupabaseBrowserClient();
  const enrollmentId = getEnrollmentId(userId, course.slug);

  const { data: existing, error: readError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("id", enrollmentId)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existing) {
    return enrollmentId;
  }

  const snapshot = createEnrollmentSnapshot(course);
  const timestamp = nowIso();

  const { error } = await supabase.from("enrollments").insert({
    id: enrollmentId,
    user_id: userId,
    course_id: snapshot.courseId,
    course_slug: snapshot.courseSlug,
    course_title: snapshot.courseTitle,
    course_category: snapshot.courseCategory,
    course_image: snapshot.courseImage,
    status: "active",
    source: "manual_demo",
    progress_percent: 0,
    last_lesson_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) {
    throw error;
  }

  return enrollmentId;
}

export async function createAdminEnrollmentForTeacherCourse(
  userId: string,
  course: TeacherCourse,
) {
  const supabase = getSupabaseBrowserClient();
  const enrollmentId = getEnrollmentId(userId, course.id);

  const { data: existing, error: readError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("id", enrollmentId)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existing) {
    return enrollmentId;
  }

  const timestamp = nowIso();

  const { error } = await supabase.from("enrollments").insert({
    id: enrollmentId,
    user_id: userId,
    course_id: course.id,
    course_slug: course.id,
    course_title: course.title,
    course_category: course.category,
    course_image: course.coverImageUrl || "/brand/logo-mark.png",
    status: "active",
    source: "admin",
    progress_percent: 0,
    last_lesson_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) {
    throw error;
  }

  return enrollmentId;
}

export function subscribeToUserEnrollments(
  userId: string,
  callback: (enrollments: Enrollment[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("enrollments")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToEnrollment).sort(byCourseTitle));
  };

  void load();

  // Re-fetch on any change to the caller's rows so sort/ordering stays exact,
  // like Firestore onSnapshot re-emitting the full query result. RLS scopes the
  // filter to the caller's own enrollments.
  const channel = supabase
    .channel(`enrollments:user:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "enrollments",
        filter: `user_id=eq.${userId}`,
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

export function subscribeToAdminGrantedEnrollments(
  callback: (enrollments: Enrollment[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("enrollments")
      .select("*")
      .in("source", ["admin", "manual_demo"]);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToEnrollment).sort(byCourseTitle));
  };

  void load();

  // Realtime server filters only support a single-column eq, not `in`, so watch
  // the whole table and re-run the filtered query on any change.
  // ponytail: table-wide change fan-in; fine for the admin-only granted list.
  const channel = supabase
    .channel("enrollments:granted")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "enrollments" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Revoke an admin/demo-granted enrollment. Hard-deletes the enrollment row
 * (admin only via RLS enrollments delete == is_admin()), the inverse of
 * createManualEnrollment / createAdminEnrollmentForTeacherCourse.
 */
export async function revokeEnrollment(enrollmentId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollmentId);

  if (error) {
    throw error;
  }
}

export function subscribeToEnrollment(
  userId: string,
  courseSlug: string,
  callback: (enrollment: Enrollment | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  const enrollmentId = getEnrollmentId(userId, courseSlug);

  void supabase
    .from("enrollments")
    .select("*")
    .eq("id", enrollmentId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(data ? rowToEnrollment(data) : null);
    });

  const channel = supabase
    .channel(`enrollments:one:${enrollmentId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "enrollments",
        filter: `id=eq.${enrollmentId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(rowToEnrollment(payload.new as unknown as EnrollmentRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
