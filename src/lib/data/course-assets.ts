"use client";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  compareCourseAssets,
  courseAssetTitleMaxLength,
  courseAssetUploadLimitMessage,
  getCourseAssetContentType,
  isAllowedCourseAssetFile,
  isCourseContentMimeType,
  supabaseUploadLimitBytes,
} from "@/domain/course-asset";
import { getSafeMediaUrl } from "@/domain/external-url";
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
    bunnyVideoId: row.bunny_video_id ?? null,
    isPreview: row.is_preview,
    lessonId: row.lesson_id,
    moduleId: row.module_id,
    // `?? null`: before migration 20261007040000 the columns do not even come back.
    title: row.title ?? null,
    position: row.position ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type UploadCourseAssetInput = {
  beforeCommit?: () => void;
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
  // null when the transport does not report progress (supabase-js upload()). The UI
  // shows "uploading" with no number instead of a bar stuck at 0%.
  percent: number | null;
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
  // The plan-level Supabase cap (not the bucket's 500MB ceiling) is what
  // actually rejects the upload, so fail fast with the actionable message
  // instead of streaming bytes into a 413. Every Storage upload path (modal,
  // covers, Bunny fallback) routes through here. Checked before the type
  // validator, which also enforces this limit but with a generic message.
  if (input.file.size > supabaseUploadLimitBytes) {
    throw new Error(courseAssetUploadLimitMessage());
  }

  if (!isAllowedCourseAssetFile(input.file, input.kind)) {
    throw new Error("Unsupported file type or file too large.");
  }

  const supabase = getSupabaseBrowserClient();
  const assetId = createAssetId();
  const safeFileName = sanitizeFileName(input.file.name);
  const storagePath = `courses/${input.courseId}/assets/${input.ownerId}/${assetId}/${safeFileName}`;
  const bucket = bucketForKind(input.kind);
  const contentType = getCourseAssetContentType(input.file);

  // ponytail: supabase-js upload() has no granular progress event. Emit an
  // honest "running, percent unknown" instead of a 0% that sat frozen for the
  // whole transfer. Upgrade to a TUS resumable upload if per-byte progress on
  // large files becomes a real UX need.
  input.onProgress?.({
    bytesTransferred: 0,
    totalBytes: input.file.size,
    percent: null,
    state: "running",
  });

  // storage-js ignores `contentType` when the body is a File and stores the File's
  // own type: an SVG ended up as image/svg+xml in storage. The new File only
  // points to the same bytes, with the safe type.
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, new File([input.file], input.file.name, { type: contentType }), {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  try {
    input.beforeCommit?.();
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
      content_type: contentType,
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
      // Reject tracker/external hosts even if storage returned an unexpected URL.
      const safeCover = getSafeMediaUrl(downloadUrl);
      if (!safeCover) {
        throw new Error("Cover image URL is not on an allowed media host.");
      }
      const { error: coverError } = await supabase
        .from(coursesTable)
        .update({ cover_image_url: safeCover, updated_at: new Date().toISOString() })
        .eq("id", input.courseId);

      if (coverError) {
        throw coverError;
      }
    }
  } catch (error) {
    await supabase.storage.from(bucket).remove([storagePath]).catch(() => undefined);
    throw error;
  }

  // "success" only after the row exists and the cover is stored. Emitted
  // earlier, a failure on the insert left "Upload complete 100%" on the screen next to
  // the red box saying the upload could not be done.
  input.onProgress?.({
    bytesTransferred: input.file.size,
    totalBytes: input.file.size,
    percent: 100,
    state: "success",
  });

  return assetId;
}

/**
 * Thrown when the creator themself cancels the upload. It is a normal outcome, not
 * a failure: the caller should clear the state without showing an error message.
 */
export class CourseAssetUploadCancelled extends Error {
  constructor() {
    super("upload-cancelled");
    this.name = "CourseAssetUploadCancelled";
  }
}

type UploadBunnyVideoInput = {
  beforeCommit?: () => void;
  courseId: string;
  ownerId: string;
  kind: "lesson_video" | "live_recording";
  file: File;
  isPreview: boolean;
  lessonId: string;
  onProgress?: (progress: UploadCourseAssetProgress) => void;
  /**
   * Receives the cancel function as soon as the upload starts. Without this the
   * tus instance stayed trapped inside the Promise executor and
   * `upload.abort()` was unreachable — there was no way to cancel an upload in
   * progress except by closing the tab.
   */
  onCancelAvailable?: (cancel: () => void) => void;
};

/**
 * Upload a lesson video to Bunny Stream. The server mints a Bunny video + a
 * short-lived TUS signature; the browser then streams the bytes straight to
 * Bunny (resumable, real per-byte progress, no serverless body limit). We record
 * a course_assets row with bunny_video_id set and no Supabase Storage object, so
 * playback resolves through a signed embed URL instead of a signed storage URL.
 */
export async function uploadLessonVideoToBunny(
  input: UploadBunnyVideoInput,
): Promise<string> {
  const { Upload } = await import("tus-js-client");

  // 1. Server creates the video object + signs the upload (secrets stay server).
  const createRes = await fetch("/api/teach/video/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courseId: input.courseId, title: input.file.name }),
  });
  if (createRes.status === 503) {
    // Bunny keys are not configured server-side (the route's documented 503
    // contract) — fall back to Supabase Storage so authoring never
    // hard-blocks. The smaller Supabase upload cap applies on this path and is
    // enforced by uploadCourseAsset before any bytes move.
    return uploadCourseAsset({
      courseId: input.courseId,
      ownerId: input.ownerId,
      kind: input.kind,
      file: input.file,
      isPreview: input.isPreview,
      lessonId: input.lessonId,
      onProgress: input.onProgress,
      beforeCommit: input.beforeCommit,
    });
  }

  if (createRes.status === 429) {
    // Two 429s: the hourly throttle (any plan, wait a little) and the Free
    // plan's daily cap (wait until tomorrow). Carry the cap's own wording out of
    // here — every caller matches on it — and keep the hourly one as a status.
    const body = (await createRes.json().catch(() => null)) as { code?: unknown } | null;
    if (body?.code === "free_plan_daily_limit") {
      throw new Error("Daily upload limit without a plan. Try again tomorrow.");
    }
  }
  if (!createRes.ok) {
    throw new Error(`bunny-create-failed:${createRes.status}`);
  }
  const { videoId, storagePath, libraryId, signature, expires, endpoint } =
    (await createRes.json()) as {
      videoId: string;
      storagePath: string;
      libraryId: string;
      signature: string;
      expires: number;
      endpoint: string;
    };

  input.onProgress?.({
    bytesTransferred: 0,
    totalBytes: input.file.size,
    percent: 0,
    state: "running",
  });

  // 2. Browser → Bunny, resumable.
  //
  // The Upload instance needs to escape the executor: before, it was born and died
  // in here, so `upload.abort()` was unreachable and there was no way to
  // cancel. Someone who picked the wrong 4 GB file, or got stuck on a bad
  // connection, could only close the tab — and then nothing resumed, the next
  // upload started from zero and an orphan video was left on Bunny.
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(input.file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expires),
        LibraryId: libraryId,
        VideoId: videoId,
      },
      metadata: {
        filetype: input.file.type || "video/mp4",
        title: input.file.name,
      },
      onError: (error) => reject(error),
      onProgress: (bytesUploaded, bytesTotal) => {
        input.onProgress?.({
          bytesTransferred: bytesUploaded,
          totalBytes: bytesTotal,
          percent: bytesTotal ? Math.round((bytesUploaded / bytesTotal) * 100) : 0,
          state: "running",
        });
      },
      onSuccess: () => resolve(),
    });

    // Hands the canceller to the caller. tus's `abort` returns a promise;
    // ignoring it is acceptable because the result that matters is the rejection
    // below, which gives control of the UI back immediately.
    input.onCancelAvailable?.(() => {
      void upload.abort();
      reject(new CourseAssetUploadCancelled());
    });

    upload.start();
  });

  // 3. Record the asset (no Storage object; storage_path is a marker only).
  input.beforeCommit?.();
  const supabase = getSupabaseBrowserClient();
  const assetId = createAssetId();
  const { error: insertError } = await supabase.from(courseAssetsTable).insert({
    id: assetId,
    course_id: input.courseId,
    owner_id: input.ownerId,
    kind: input.kind,
    file_name: input.file.name,
    content_type: input.file.type || "video/mp4",
    size: input.file.size,
    storage_path: storagePath,
    download_url: null,
    bunny_video_id: videoId,
    is_preview: input.isPreview,
    lesson_id: input.lessonId,
    module_id: null,
  });
  if (insertError) {
    throw insertError;
  }

  // Same rule as the Supabase path: done only when the row exists.
  input.onProgress?.({
    bytesTransferred: input.file.size,
    totalBytes: input.file.size,
    percent: 100,
    state: "success",
  });

  return assetId;
}

/**
 * Short-lived signed URL for a gated asset (lesson video/material). RLS on
 * storage.objects only issues it to the course owner, an enrolled learner, or an
 * admin — so this is safe to call directly from the client.
 *
 * `download`: the download link. The `download` attribute of an <a> does not apply to
 * another domain (Supabase's), so the "Download" button only opened the file.
 * With `download=<name>` on the link, Supabase answers "attachment" with the file's
 * original name. The rule for who gets the link is the same: RLS's.
 *
 * The name does NOT go through storage-js's `download` option: it encodes the name
 * (URLSearchParams) and then the whole link again (encodeURI), and the server
 * decodes only once. "Introdução.pdf" downloaded as
 * "Introdu%C3%A7%C3%A3o.pdf". Here it is encoded once.
 */
export async function getProtectedCourseAssetObjectUrl(
  asset: CourseAsset,
  options: { download?: boolean } = {},
) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.storage
    .from(bucketForKind(asset.kind))
    .createSignedUrl(asset.storagePath, 3600);

  if (error) {
    throw error;
  }

  // Old file with a type outside the bucket's list (SVG, HTML, XML): the open
  // link also comes as an attachment. Opened in the tab, its script would run on the
  // storage domain. <img> and <video> ignore the attachment and keep displaying.
  if (!options.download && isCourseContentMimeType(asset.contentType)) {
    return data.signedUrl;
  }

  const separator = data.signedUrl.includes("?") ? "&" : "?";
  return `${data.signedUrl}${separator}download=${encodeURIComponent(asset.fileName)}`;
}

// One-shot load for callers that must not open a second realtime channel on
// the `course_assets:{courseId}` topic (one join per topic per socket).
export async function fetchCourseAssets(courseId: string): Promise<CourseAsset[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from(courseAssetsTable)
    .select("*")
    .eq("course_id", courseId);

  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  // Teacher's order (position), then the name. Sorted here and not in the database:
  // `.order("position")` would break the read while the column does not exist.
  return (data ?? []).map(rowToCourseAsset).sort(compareCourseAssets);
}

/**
 * RLS does not return an error when it filters out the row (session without a second factor, course
 * of another owner): the update just changes nothing. Without this check the screen said
 * "Name saved." without having saved.
 */
function assertOneRowUpdated(result: { data: unknown[] | null; error: unknown }) {
  if (result.error) {
    throw result.error;
  }
  if (!result.data || result.data.length === 0) {
    throw new Error("course-asset-not-updated");
  }
}

/** Name the learner sees. Empty goes back to showing the file name. */
export async function renameCourseAsset(assetId: string, title: string) {
  const supabase = getSupabaseBrowserClient();
  const trimmed = title.trim().slice(0, courseAssetTitleMaxLength);
  assertOneRowUpdated(
    await supabase
      .from(courseAssetsTable)
      .update({ title: trimmed || null })
      .eq("id", assetId)
      .select("id"),
  );
}

/**
 * Stores the order of the list: position = index. Only sends the rows that changed
 * (swapping two neighbors costs two writes).
 */
export async function saveCourseAssetOrder(ordered: Pick<CourseAsset, "id" | "position">[]) {
  const supabase = getSupabaseBrowserClient();
  const results = await Promise.all(
    ordered
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset, index }) => asset.position !== index)
      .map(({ asset, index }) =>
        supabase.from(courseAssetsTable).update({ position: index }).eq("id", asset.id).select("id"),
      ),
  );
  results.forEach(assertOneRowUpdated);
}

/**
 * How many files the teacher has in media, adding up their courses. The Marketing panel
 * only needs the number: requesting the rows of each course (or opening
 * a realtime channel per course) to count afterwards would be expensive for nothing.
 */
export async function countCourseAssets(courseIds: string[]): Promise<number> {
  if (courseIds.length === 0) {
    return 0;
  }

  const supabase = getSupabaseBrowserClient();
  const { count, error } = await supabase
    .from(courseAssetsTable)
    .select("id", { count: "exact", head: true })
    .in("course_id", courseIds);

  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  return count ?? 0;
}

// Same object for the row that did not change. ProtectedAssetPreview signs the URL
// again when it receives a new object: an uploaded video would restart in the middle and
// a PDF would download again on every reload, even with nothing changed.
function keepUnchangedAssets(previous: CourseAsset[], next: CourseAsset[]): CourseAsset[] {
  const previousById = new Map(previous.map((asset) => [asset.id, asset]));
  return next.map((asset) => {
    const old = previousById.get(asset.id);
    const keys = Object.keys(asset) as (keyof CourseAsset)[];
    const unchanged = Boolean(old)
      && keys.length === Object.keys(old!).length
      && keys.every((key) => old![key] === asset[key]);
    return unchanged ? old! : asset;
  });
}

/**
 * Realtime channel of the course attachments. The return value shuts the channel down and brings
 * `reload()`: fetches again WITHOUT touching the channel. The room uses it when a lesson opens
 * from the calendar, a moment when nothing changes in the database and realtime does not wake up.
 */
export function subscribeToCourseAssets(
  courseId: string,
  callback: (assets: CourseAsset[]) => void,
  onError: (error: Error) => void,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  let active = true;
  let latestLoad = 0;
  let delivered: CourseAsset[] = [];

  const load = async (quiet = false) => {
    const thisLoad = ++latestLoad;
    try {
      const assets = await fetchCourseAssets(courseId);
      // Channel shut down, or a newer load already came out: this response is old.
      if (!active || thisLoad !== latestLoad) return;
      delivered = keepUnchangedAssets(delivered, assets);
      callback(delivered);
    } catch (error) {
      if (!active || thisLoad !== latestLoad) return;
      // A standalone reload that fails keeps the list that is already on the screen.
      if (quiet) {
        console.warn("Course assets reload failed; keeping the previous list", error);
        return;
      }
      onError(error instanceof Error ? error : new Error(String(error)));
    }
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

  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: () => load(true) },
  );
}

/**
 * Remove a course asset so a wrong video/PDF/cover is never stuck. Deletes the
 * Storage object and the course_assets row, and clears the course cover when the
 * asset being removed is the one currently in use. Owner only (enforced by the
 * course_assets + storage.objects RLS), so callers must guard the UI behind an
 * editable course state.
 */
/**
 * Aligns the is_preview flag of the course videos with the lesson chosen as the free
 * preview.
 *
 * The anonymous lookup that feeds the public sales page filters by
 * `.eq("is_preview", true)` (src/app/api/courses/video-token/route.ts). Marking the
 * lesson as the preview in the builder only touched a course field, so an already
 * uploaded video never got the flag and the store answered "Video unavailable" — with the
 * studio showing everything ready.
 *
 * Clears the flag on the videos of the other lessons in the same pass: there is only one preview, and
 * switching lessons has to unpublish the previous one, otherwise the course keeps accumulating
 * paid videos open to the public.
 */
export async function syncLessonPreviewAssets(
  courseId: string,
  previewLessonId: string,
) {
  const supabase = getSupabaseBrowserClient();
  const videoKinds = ["lesson_video", "live_recording"];

  // Unchecks every video that is not from the preview lesson (includes the case of
  // an empty previewLessonId, which means "no preview").
  const clear = supabase
    .from(courseAssetsTable)
    .update({ is_preview: false })
    .eq("course_id", courseId)
    .in("kind", videoKinds)
    .eq("is_preview", true);

  const { error: clearError } = previewLessonId
    ? await clear.neq("lesson_id", previewLessonId)
    : await clear;

  if (clearError) {
    throw clearError;
  }

  if (!previewLessonId) {
    return;
  }

  const { error: markError } = await supabase
    .from(courseAssetsTable)
    .update({ is_preview: true })
    .eq("course_id", courseId)
    .eq("lesson_id", previewLessonId)
    .in("kind", videoKinds);

  if (markError) {
    throw markError;
  }
}

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
