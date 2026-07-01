"use client";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import { isAllowedCourseAssetFile } from "@/domain/course-asset";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const courseAssetsTable = "course_assets";
const coursesTable = "courses";

// Covers/thumbnails live in the world-readable `public-media` bucket (rendered
// on the public marketplace by URL); gated lesson video/materials live in the
// private `course-content` bucket and are read through short-lived signed URLs.
const publicMediaKinds = new Set<CourseAssetKind>([
  "course_cover",
  "members_cover",
  "module_cover",
  "lesson_thumbnail",
]);

function bucketForKind(kind: CourseAssetKind): "public-media" | "course-content" {
  return publicMediaKinds.has(kind) ? "public-media" : "course-content";
}

type CourseAssetRow = Database["public"]["Tables"]["course_assets"]["Row"];

function rowToCourseAsset(row: CourseAssetRow): CourseAsset {
  return {
    id: row.id,
    courseId: row.course_id,
    ownerId: row.owner_id,
    kind: row.kind as CourseAssetKind,
    fileName: row.file_name,
    contentType: row.content_type,
    size: row.size,
    storagePath: row.storage_path,
    downloadUrl: row.download_url,
    isPreview: row.is_preview,
    lessonId: row.lesson_id,
    moduleId: row.module_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type UploadCourseAssetInput = {
  courseId: string;
  ownerId: string;
  kind: CourseAssetKind;
  file: File;
  isPreview: boolean;
  lessonId?: string | null;
  moduleId?: string | null;
  onProgress?: (progress: UploadCourseAssetProgress) => void;
};

export type UploadCourseAssetProgress = {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
  state: "paused" | "running" | "success";
};

function createAssetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 120) || "asset";
}

export async function uploadCourseAsset(input: UploadCourseAssetInput) {
  if (!isAllowedCourseAssetFile(input.file, input.kind)) {
    throw new Error("Unsupported file type or file too large.");
  }

  const supabase = getSupabaseBrowserClient();
  const assetId = createAssetId();
  const safeFileName = sanitizeFileName(input.file.name);
  const storagePath = `courses/${input.courseId}/assets/${input.ownerId}/${assetId}/${safeFileName}`;
  const bucket = bucketForKind(input.kind);

  // ponytail: supabase-js upload() has no granular progress event, so we emit a
  // coarse running(0%) -> success(100%) pair. Upgrade to a TUS resumable upload
  // if per-byte progress on large videos becomes a real UX need.
  input.onProgress?.({
    bytesTransferred: 0,
    totalBytes: input.file.size,
    percent: 0,
    state: "running",
  });

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, input.file, {
      contentType: input.file.type,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  input.onProgress?.({
    bytesTransferred: input.file.size,
    totalBytes: input.file.size,
    percent: 100,
    state: "success",
  });

  try {
    const downloadUrl =
      bucket === "public-media"
        ? supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl
        : null;

    const { error: insertError } = await supabase.from(courseAssetsTable).insert({
      id: assetId,
      course_id: input.courseId,
      owner_id: input.ownerId,
      kind: input.kind,
      file_name: input.file.name,
      content_type: input.file.type,
      size: input.file.size,
      storage_path: storagePath,
      download_url: downloadUrl,
      is_preview: input.isPreview,
      lesson_id: input.lessonId ?? null,
      module_id: input.moduleId ?? null,
    });

    if (insertError) {
      throw insertError;
    }

    if (input.kind === "course_cover") {
      const { error: coverError } = await supabase
        .from(coursesTable)
        .update({ cover_image_url: downloadUrl, updated_at: new Date().toISOString() })
        .eq("id", input.courseId);

      if (coverError) {
        throw coverError;
      }
    }
  } catch (error) {
    await supabase.storage.from(bucket).remove([storagePath]).catch(() => undefined);
    throw error;
  }

  return assetId;
}

/**
 * Short-lived signed URL for a gated asset (lesson video/material). RLS on
 * storage.objects only issues it to the course owner, an enrolled learner, or an
 * admin — so this is safe to call directly from the client.
 */
export async function getProtectedCourseAssetObjectUrl(asset: CourseAsset) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.storage
    .from(bucketForKind(asset.kind))
    .createSignedUrl(asset.storagePath, 3600);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export function subscribeToCourseAssets(
  courseId: string,
  callback: (assets: CourseAsset[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(courseAssetsTable)
      .select("*")
      .eq("course_id", courseId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToCourseAsset)
        .sort((left, right) => left.fileName.localeCompare(right.fileName)),
    );
  };

  void load();

  const channel = supabase
    .channel(`course_assets:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: courseAssetsTable,
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
 * Remove a course asset so a wrong video/PDF/cover is never stuck. Deletes the
 * Storage object and the course_assets row, and clears the course cover when the
 * asset being removed is the one currently in use. Owner only (enforced by the
 * course_assets + storage.objects RLS), so callers must guard the UI behind an
 * editable course state.
 */
export async function deleteCourseAsset(asset: CourseAsset) {
  const supabase = getSupabaseBrowserClient();

  // Drop the Storage object first; a missing object must not block clearing the
  // row (otherwise a half-deleted asset would be unremovable).
  await supabase.storage
    .from(bucketForKind(asset.kind))
    .remove([asset.storagePath])
    .catch(() => undefined);

  const { error: deleteError } = await supabase
    .from(courseAssetsTable)
    .delete()
    .eq("id", asset.id);

  if (deleteError) {
    throw deleteError;
  }

  if (asset.kind === "course_cover") {
    const { data: course } = await supabase
      .from(coursesTable)
      .select("cover_image_url")
      .eq("id", asset.courseId)
      .maybeSingle();

    // Only clear the cover when this asset is the one currently shown, so
    // deleting an older cover never wipes a newer one.
    if (course && course.cover_image_url === asset.downloadUrl) {
      await supabase
        .from(coursesTable)
        .update({ cover_image_url: null, updated_at: new Date().toISOString() })
        .eq("id", asset.courseId);
    }
  }
}
