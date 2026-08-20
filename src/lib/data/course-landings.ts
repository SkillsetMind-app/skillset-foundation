"use client";

/**
 * Read and write a course's sales page.
 *
 * Reads go straight at the table, because RLS already answers the only question
 * that matters: the public policy mirrors `courses_select_public` exactly, so a
 * landing page becomes visible at the same moment its course does, and the owner
 * always sees their own — including while the course is still a draft, which is
 * precisely when they are building the page.
 *
 * Writes go through `save_own_course_landing`, never through `.update()`. That
 * RPC is where ownership, the plan's block quota, the template gate and the size
 * ceiling are enforced. A direct write would move all four into the browser.
 */

import {
  normalizeCourseLandingBlocks,
  normalizeCourseLandingTemplate,
  type CourseLandingBlock,
  type CourseLandingTemplate,
} from "@/domain/course-landing";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CourseLanding = {
  template: CourseLandingTemplate;
  blocks: CourseLandingBlock[];
};

export const emptyCourseLanding: CourseLanding = {
  template: "classic",
  blocks: [],
};

/**
 * Normalised on the way OUT as well as on the way in. The row is jsonb and could
 * have been written by an older client, or edited directly; re-normalising here
 * means the renderer only ever receives shapes it knows, and a stale block that
 * no longer validates disappears instead of crashing the page.
 */
export async function getCourseLanding(courseId: string): Promise<CourseLanding> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("course_landings")
    .select("template, blocks")
    .eq("course_id", courseId)
    .maybeSingle();

  if (error || !data) {
    return emptyCourseLanding;
  }

  return {
    template: normalizeCourseLandingTemplate(data.template),
    blocks: normalizeCourseLandingBlocks(data.blocks),
  };
}

export type SaveLandingResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Error messages are rewritten for the teacher. The raw Postgres text says
 * things like `block quota reached: 9 of 8`, which is precise and unreadable.
 */
function readableSaveError(message: string): string {
  if (/block quota reached/i.test(message)) {
    return "This page has more blocks than your plan allows. Remove one, or upgrade.";
  }
  if (/template not included/i.test(message)) {
    return "That template is not included on your plan.";
  }
  if (/too large/i.test(message)) {
    return "This page is too long. Shorten a section and try again.";
  }
  if (/not your course/i.test(message)) {
    return "You can only edit your own courses.";
  }
  return "Could not save the page.";
}

export async function saveCourseLanding(
  courseId: string,
  landing: CourseLanding,
): Promise<SaveLandingResult> {
  const supabase = getSupabaseBrowserClient();

  // Normalised before sending so the client never asks the server to store
  // something it would refuse. The server normalises again regardless — this is
  // for a fast, accurate error, not for safety.
  const blocks = normalizeCourseLandingBlocks(landing.blocks);
  const template = normalizeCourseLandingTemplate(landing.template);

  const { error } = await supabase.rpc("save_own_course_landing", {
    p_course_id: courseId,
    p_template: template,
    p_blocks: blocks as unknown as never,
  });

  if (error) {
    return { ok: false, reason: readableSaveError(error.message ?? "") };
  }

  return { ok: true };
}
