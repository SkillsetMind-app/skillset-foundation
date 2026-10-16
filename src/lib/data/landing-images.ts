"use client";

/**
 * Images of a course's sales page (hero background, "about" photo).
 *
 * They go straight to the public bucket under `courses/{courseId}/landing/`,
 * with NO course_assets row. A row would make them course material: enrolled
 * students can read lesson-less rows, so the image showed up in the classroom's
 * Materials tab, and the builder listed it with a Delete button that silently
 * broke the page. The `public-media` storage policies already limit writes and
 * deletes under `courses/{courseId}/` to the course owner, and the bucket itself
 * refuses SVG and anything over 25 MB.
 */

import { allowedAvatarTypes, maxAvatarBytes } from "@/lib/data/profile-media";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const bucket = "public-media";

// Same rules as the storefront hero: formats every browser renders, never SVG.
export const landingImageTypes: readonly string[] = allowedAvatarTypes;
export const landingImageMaxBytes = maxAvatarBytes;

function landingFolder(courseId: string) {
  return `courses/${courseId}/landing/`;
}

export async function uploadLandingImage(courseId: string, file: File): Promise<string> {
  if (!landingImageTypes.includes(file.type) || file.size <= 0 || file.size > landingImageMaxBytes) {
    throw new Error("Unsupported file type or file too large.");
  }

  const supabase = getSupabaseBrowserClient();
  // `image/jpeg` -> `jpeg`. A fresh name per upload: replacing an image never
  // overwrites the file the saved page is still showing.
  const path = `${landingFolder(courseId)}${crypto.randomUUID()}.${file.type.slice("image/".length)}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    throw error;
  }

  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Deletes the files behind these URLs. Only this course's sales page files are
 * touched: pasted links, covers and anything else are skipped, so a URL the
 * creator typed can never delete something else.
 */
export async function removeLandingImages(courseId: string, urls: readonly string[]) {
  const supabase = getSupabaseBrowserClient();
  const folder = landingFolder(courseId);
  const prefix = supabase.storage.from(bucket).getPublicUrl(folder).data.publicUrl;
  const paths = urls
    .filter((url) => url.startsWith(prefix))
    .map((url) => url.slice(prefix.length))
    .filter((name) => /^[\w-]+\.(?:jpeg|png|webp)$/.test(name))
    .map((name) => `${folder}${name}`);

  if (paths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) {
    throw error;
  }
}
