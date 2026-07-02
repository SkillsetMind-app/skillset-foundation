"use client";

import type { LearningPath } from "@/domain/learning-path";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// ponytail: one-shot fetch, no Realtime channel — curated paths change rarely
// (admin-only writes) and a page load is always fresh enough. Subscribe like
// course-reviews if live curation ever matters.
export async function fetchPublishedLearningPaths(): Promise<LearningPath[]> {
  const supabase = getSupabaseBrowserClient();

  const { data: paths, error } = await supabase
    .from("learning_paths")
    .select("id, title, description, position")
    .eq("status", "published")
    .order("position", { ascending: true })
    .limit(20);
  if (error) {
    throw error;
  }
  if (!paths || paths.length === 0) {
    return [];
  }

  const { data: items, error: itemsError } = await supabase
    .from("learning_path_items")
    .select("path_id, course_id, position")
    .in(
      "path_id",
      paths.map((path) => path.id),
    )
    .order("position", { ascending: true });
  if (itemsError) {
    throw itemsError;
  }

  return paths.map((path) => ({
    id: path.id,
    title: path.title,
    description: path.description,
    courseIds: (items ?? [])
      .filter((item) => item.path_id === path.id)
      .map((item) => item.course_id),
  }));
}
