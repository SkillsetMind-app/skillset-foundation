"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { recordLessonVideoSelection, runCourseWrite } from "./course-write-queue";

function isObject(value: Json): value is { [key: string]: Json | undefined } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Read the latest curriculum, never the editor snapshot captured before upload.
// The conditional write preserves concurrent saves and keeps normal owner RLS.
export async function activateUploadedLessonVideo(courseId: string, lessonId: string, assetId: string, assertActive: () => void = () => {}) {
  return runCourseWrite(courseId, () => connectVideo(courseId, lessonId, assetId, assertActive));
}

async function connectVideo(courseId: string, lessonId: string, assetId: string, assertActive: () => void) {
  assertActive();
  const client = getSupabaseBrowserClient();
  const asset = await client.from("course_assets")
    .select("id")
    .eq("id", assetId)
    .eq("course_id", courseId)
    .eq("lesson_id", lessonId)
    .in("kind", ["lesson_video", "live_recording"])
    .maybeSingle();
  assertActive();
  if (asset.error) throw asset.error;
  if (!asset.data) throw new Error("The uploaded video is no longer available for this lesson.");

  // ponytail: three optimistic retries; surface a conflict instead of overwriting.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertActive();
    const current = await client.from("courses").select("modules, updated_at").eq("id", courseId).single();
    assertActive();
    if (current.error) throw current.error;
    const original = current.data.modules;
    const revision = current.data.updated_at;
    if (!revision || !Number.isFinite(Date.parse(revision))) throw new Error("The course revision is unavailable.");
    if (!Array.isArray(original)) throw new Error("The course curriculum is unavailable.");
    let matches = 0;
    const modules = original.map((module) => {
      if (!isObject(module) || !Array.isArray(module.lessons)) return module;
      return {
        ...module,
        lessons: module.lessons.map((lesson) => {
          if (!isObject(lesson) || lesson.id !== lessonId) return lesson;
          matches += 1;
          return { ...lesson, videoSource: "upload" };
        }),
      };
    });
    if (matches !== 1) throw new Error("The lesson changed while the video was uploading. Reopen the lesson to continue.");
    assertActive();
    const saved = await client.from("courses")
      .update({ modules, updated_at: "now" })
      .eq("id", courseId)
      .eq("updated_at", revision)
      .select("id, updated_at");
    assertActive();
    if (saved.error) throw saved.error;
    if (saved.data?.length === 1) {
      if (!saved.data[0].updated_at) throw new Error("The saved course revision is unavailable.");
      recordLessonVideoSelection(courseId, lessonId, "upload", saved.data[0].updated_at);
      return;
    }
  }
  throw new Error("The course is being edited elsewhere. Reopen the lesson to finish connecting the uploaded video.");
}
