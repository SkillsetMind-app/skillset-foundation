"use client";

import type { CourseReview } from "@/domain/course-review";
import {
  normalizeCourseReviewBody,
  normalizeCourseReviewRating,
} from "@/domain/course-review";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const courseReviewsTable = "course_reviews";

type CourseReviewRow = Database["public"]["Tables"]["course_reviews"]["Row"];

function rowToReview(row: CourseReviewRow): CourseReview {
  return {
    id: row.id,
    courseId: row.course_id,
    authorName: row.author_name,
    rating: row.rating,
    body: row.body,
    status: row.status as CourseReview["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// submitCourseReview callable → submit_course_review RPC (SECURITY DEFINER):
// enforces the enrollment + >=50% gate, upserts the review, and recomputes the
// course rating aggregate atomically (privileged columns via the trusted-write
// flag). The RPC normalizes the body itself; "" is treated as null.
export async function submitCourseReview(input: {
  courseId: string;
  rating: number;
  body: string;
}) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("submit_course_review", {
    p_course_id: input.courseId,
    p_rating: normalizeCourseReviewRating(input.rating),
    p_body: normalizeCourseReviewBody(input.body) ?? "",
  });

  if (error) {
    throw error;
  }

  return data as unknown as {
    success: true;
    reviewId: string;
    ratingAverage: number;
    ratingCount: number;
  };
}

export function getCourseReviewId(courseId: string, userId: string) {
  return `${courseId}__${userId}`;
}

export function subscribeToCourseReviews(
  courseId: string,
  callback: (reviews: CourseReview[]) => void,
  onError: (error: Error) => void,
  maxReviews = 12,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(courseReviewsTable)
      .select("*")
      .eq("course_id", courseId)
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(maxReviews);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToReview));
  };

  void load();

  const channel = supabase
    .channel(`course_reviews:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: courseReviewsTable,
        filter: `course_id=eq.${courseId}`,
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

export function subscribeToUserCourseReview(
  courseId: string,
  userId: string,
  callback: (review: CourseReview | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  const reviewId = getCourseReviewId(courseId, userId);

  const load = async () => {
    const { data, error } = await supabase
      .from(courseReviewsTable)
      .select("*")
      .eq("id", reviewId)
      .maybeSingle();

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(data ? rowToReview(data) : null);
  };

  void load();

  const channel = supabase
    .channel(`course_reviews:${reviewId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: courseReviewsTable,
        filter: `id=eq.${reviewId}`,
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
