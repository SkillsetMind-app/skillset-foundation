"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * B1 — paywalled lesson content moved OUT of the world-readable course doc into
 * the enrollment-gated table course_lesson_content (lesson_id PK). The shape is
 * locked by RLS. The builder writes this table while the public curriculum
 * stores only the lesson structure, without text or external URLs.
 */
export type LessonContent = {
  contentText: string | null;
  externalUrl: string | null;
};

type LessonContentRow =
  Database["public"]["Tables"]["course_lesson_content"]["Row"];

function rowToLessonContent(row: LessonContentRow): LessonContent {
  return {
    contentText: row.content_text,
    externalUrl: row.external_url,
  };
}

/**
 * Realtime subscription to every lesson's gated content for a course, keyed by
 * lessonId. Consumers (enrolled workspace) merge this onto the matching lesson,
 * preferring the table value and falling back to the inline field when a row is
 * absent (un-migrated course during transition). Mirrors the
 * subscribeToCourseAssets onSnapshot style.
 */
export function subscribeToLessonContent(
  courseId: string,
  callback: (content: Map<string, LessonContent>) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("course_lesson_content")
      .select("*")
      .eq("course_id", courseId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const next = new Map<string, LessonContent>();
    for (const row of data ?? []) {
      next.set(row.lesson_id, rowToLessonContent(row));
    }

    callback(next);
  };

  void load();

  const channel = supabase
    .channel(`course_lesson_content:course:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_lesson_content",
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

/**
 * One-shot read of a single lesson's gated content. Used by the public
 * free-preview surface. RLS permits an anonymous read only for the designated
 * preview of a published course. Other lessons require owner/admin access or an
 * active/completed enrollment. The inline fallback covers unmigrated curricula.
 */
export async function getLessonContentDoc(
  courseId: string,
  lessonId: string,
): Promise<LessonContent | null> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("course_lesson_content")
    .select("*")
    .eq("lesson_id", lessonId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return rowToLessonContent(data);
}

/**
 * Resolve a lesson's effective content: prefer the gated table value, fall back
 * to the inline field when the row is absent. Shared by the enrolled workspace
 * and the public preview so the merge rule is identical everywhere.
 */
export function resolveLessonContent(
  subcollection: LessonContent | undefined,
  inline: { contentText?: string | null; externalUrl?: string | null },
): LessonContent {
  if (subcollection) {
    return subcollection;
  }

  return {
    contentText: inline.contentText ?? null,
    externalUrl: inline.externalUrl ?? null,
  };
}
