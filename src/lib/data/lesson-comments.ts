"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type LessonCommentRow = Database["public"]["Tables"]["lesson_comments"]["Row"];

export type LessonComment = {
  id: string;
  courseId: string;
  lessonId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function rowToLessonComment(row: LessonCommentRow): LessonComment {
  return {
    id: row.id,
    courseId: row.course_id,
    lessonId: row.lesson_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function addLessonComment(input: {
  courseId: string;
  lessonId: string;
  authorId: string;
  authorName: string;
  body: string;
}) {
  const body = input.body.trim();

  if (body.length < 3) {
    throw new Error("Comment is too short.");
  }

  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { error } = await supabase.from("lesson_comments").insert({
    course_id: input.courseId,
    lesson_id: input.lessonId,
    author_id: input.authorId,
    author_name: input.authorName.trim() || "SkillsetMind learner",
    body,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) {
    throw error;
  }
}

export async function deleteLessonComment(courseId: string, commentId: string) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("lesson_comments")
    .delete()
    .eq("id", commentId)
    .eq("course_id", courseId);

  if (error) {
    throw error;
  }
}

export function subscribeToLessonComments(
  courseId: string,
  lessonId: string,
  callback: (comments: LessonComment[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("lesson_comments")
      .select("*")
      .eq("course_id", courseId)
      .eq("lesson_id", lessonId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? []).map(rowToLessonComment).sort((left, right) => {
        const leftTime = left.createdAt ?? "";
        const rightTime = right.createdAt ?? "";
        return leftTime.localeCompare(rightTime);
      }),
    );
  };

  void load();

  // Realtime server filters only support a single-column eq, not compound
  // course_id+lesson_id, so watch the whole table and re-run the filtered query.
  // ponytail: table-wide change fan-in; negligible for per-lesson comment volumes.
  const channel = supabase
    .channel(`lesson_comments:lesson:${courseId}:${lessonId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lesson_comments" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
