export type CourseAssetKind =
  | "course_cover"
  | "members_cover"
  | "module_cover"
  | "lesson_thumbnail"
  | "lesson_material"
  | "lesson_video"
  | "live_recording";

export type CourseAsset = {
  id: string;
  courseId: string;
  ownerId: string;
  kind: CourseAssetKind;
  fileName: string;
  contentType: string;
  size: number;
  storagePath: string;
  downloadUrl?: string | null;
  // Set when the video is hosted on Bunny Stream instead of Supabase Storage;
  // playback then uses a signed embed URL rather than a signed storage URL.
  bunnyVideoId?: string | null;
  isPreview: boolean;
  lessonId: string | null;
  moduleId?: string | null;
  /** Name the teacher gave the file. Null: the file name is used. */
  title?: string | null;
  /** Order in the lesson, starting at 0. Null (new file): goes to the end. */
  position?: number | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const courseAssetTitleMaxLength = 180;

/** What the learner reads: the name given by the teacher, otherwise the file name. */
export function getCourseAssetTitle(asset: Pick<CourseAsset, "title" | "fileName">): string {
  return asset.title?.trim() || asset.fileName;
}

/** Position first (no position goes to the end), then the name that is shown. */
export function compareCourseAssets(left: CourseAsset, right: CourseAsset): number {
  const a = left.position ?? Number.POSITIVE_INFINITY;
  const b = right.position ?? Number.POSITIVE_INFINITY;
  if (a !== b) return a < b ? -1 : 1;
  return getCourseAssetTitle(left).localeCompare(getCourseAssetTitle(right));
}

// Which kinds count as "the lesson video". The literal comparison was open-coded
// in five places (status label, asset filter, saving the source after the
// upload, player choice); a sixth video kind would have to be remembered in
// all of them, and forgetting one means the source silently stops being declared.
export function isVideoAssetKind(kind: CourseAssetKind): boolean {
  return kind === "lesson_video" || kind === "live_recording";
}

export const courseAssetKindLabels: Record<CourseAssetKind, string> = {
  course_cover: "Course cover",
  members_cover: "Members area cover",
  module_cover: "Module cover",
  lesson_thumbnail: "Lesson thumbnail",
  lesson_material: "Lesson material",
  lesson_video: "Lesson video",
  live_recording: "Live recording",
};

export const courseAssetAcceptTypes: Record<CourseAssetKind, string> = {
  course_cover: "image/*",
  members_cover: "image/*",
  module_cover: "image/*",
  lesson_thumbnail: "image/*",
  lesson_material:
    [
      "application/pdf",
      ".doc",
      ".docx",
      ".ppt",
      ".pptx",
      ".xls",
      ".xlsx",
      ".csv",
      ".zip",
      // E-book and mind maps (XMind and FreeMind). The browser usually does not
      // know their type, so the extension is what opens the picker.
      ".epub",
      "application/epub+zip",
      ".xmind",
      ".mm",
      "text/*",
      "image/*",
      "audio/*",
    ].join(","),
  lesson_video: "video/*",
  live_recording: "video/*",
};

export const courseAssetMaxBytes = 500 * 1024 * 1024;

// The Supabase *plan-level* per-upload cap wins over the bucket's 500MB
// setting — the free plan cuts every Storage upload at 50MB with a 413. Client
// validation must use the effective (smaller) limit, overridable via env when
// the plan changes.
const parsedSupabaseUploadLimitMb = Number(
  process.env.NEXT_PUBLIC_SUPABASE_UPLOAD_LIMIT_MB,
);
export const supabaseUploadLimitBytes = Math.min(
  (Number.isFinite(parsedSupabaseUploadLimitMb) && parsedSupabaseUploadLimitMb > 0
    ? parsedSupabaseUploadLimitMb
    : 50) *
    1024 *
    1024,
  courseAssetMaxBytes,
);

export function courseAssetUploadLimitMessage(
  limitBytes: number = supabaseUploadLimitBytes,
  t?: (key: string) => string,
): string {
  return uploadLimitMessage(formatCourseAssetSize(limitBytes), t);
}

function uploadLimitMessage(limit: string, t?: (key: string) => string): string {
  return t
    ? t("courseMedia.upload.errors.limit").replace("{limit}", () => limit)
    : `This file exceeds the current upload limit (~${limit}). Use a YouTube link or a smaller file.`;
}

function readUploadErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  // Supabase StorageApiError exposes `status`/`statusCode`; duck-type both so
  // this stays decoupled from the supabase-js error classes.
  const { status, statusCode } = error as {
    status?: unknown;
    statusCode?: unknown;
  };

  for (const candidate of [status, statusCode]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

// Turns a storage/database upload failure into copy the teacher can act on.
// The generic "we could not upload" message hid the real blocker (the 413 from
// the plan-level size cap) and made failures look random.
export function getCourseAssetUploadErrorMessage(
  error: unknown,
  limitBytes: number = supabaseUploadLimitBytes,
  t?: (key: string) => string,
): string {
  const status = readUploadErrorStatus(error);
  const message = error instanceof Error ? error.message : "";
  const translated = (key: string, fallback: string) =>
    t ? t(`courseMedia.upload.errors.${key}`) : fallback;

  if (
    status === 413 ||
    /exceeded the maximum allowed size|payload too large|exceeds the current upload limit/i.test(
      message,
    )
  ) {
    // Keep the original preflight limit even if this screen has another default.
    if (/exceeds the current upload limit/i.test(message)) {
      if (!t) return message;
      const capturedLimit = /\(~(\d+(?:\.\d+)? (?:B|KB|MB|GB))\)/.exec(message)?.[1];
      return uploadLimitMessage(capturedLimit ?? formatCourseAssetSize(limitBytes), t);
    }
    return courseAssetUploadLimitMessage(limitBytes, t);
  }

  if (
    status === 403 ||
    /row-level security|not authorized|permission/i.test(message)
  ) {
    return translated("permission", "You do not have permission to upload files to this course.");
  }

  // Failures from the video provider arrived as `bunny-create-failed:<status>` and
  // were printed raw in the studio's red box. The creator read
  // "bunny-create-failed:429" with no hint that all they had to do was wait.
  const bunnyStatus = /bunny-create-failed:(\d{3})/.exec(message)?.[1];
  if (bunnyStatus) {
    if (bunnyStatus === "429") {
      return translated("rateLimit", "Too many uploads in the last hour. Wait a little and try again — nothing was lost.");
    }
    if (bunnyStatus === "401" || bunnyStatus === "419") {
      return translated("session", "Your session expired. Sign in again and re-send the file.");
    }
    if (bunnyStatus === "403") {
      return translated("videoPermission", "You do not have permission to upload video to this course.");
    }
    return translated("videoService", "Our video service did not accept the file just now. Try again in a few minutes.");
  }

  // tus (resumable upload) throws DetailedError, whose message is a paragraph of
  // method, URL and offset. Detects it by shape, since it does not expose `status`.
  if (
    error
    && typeof error === "object"
    && ("originalRequest" in error || "originalResponse" in error)
  ) {
    return translated("interrupted", "The upload was interrupted — usually the connection dropped. Check your internet and send the file again.");
  }

  if (t) {
    // These local transport errors are actionable; unknown provider text stays
    // out of localized UI. Callers without a translator retain the legacy copy.
    const localErrors: Record<string, string> = {
      "Unsupported file type or file too large.": "invalidFile",
      "Cover image URL is not on an allowed media host.": "coverHost",
      "Daily upload limit without a plan. Try again tomorrow.": "freePlanDailyLimit",
    };
    const key = Object.hasOwn(localErrors, message.trim())
      ? localErrors[message.trim()]
      : "generic";
    return t(`courseMedia.upload.errors.${key}`);
  }

  // Last line of defense: never return text that only makes sense to whoever
  // wrote the code.
  const looksInternal =
    /^[a-z0-9-]+:[0-9]{3}$/i.test(message.trim())
    || /tus:|fetch failed|NetworkError|ECONNRESET|ETIMEDOUT/i.test(message);

  return message.trim() && !looksInternal
    ? message
    : "We could not upload this file. Check the file type and course permissions.";
}

// Bunny-hosted videos upload resumably (TUS) straight to the CDN, so they are
// not bound by the 500MB Supabase ceiling. 5GB comfortably covers long lessons.
export const bunnyVideoMaxBytes = 5 * 1024 * 1024 * 1024;

export function isAllowedBunnyVideoFile(file: File): boolean {
  return file.type.startsWith("video/") && file.size <= bunnyVideoMaxBytes;
}

const lessonMaterialMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/zip",
  "application/x-zip-compressed",
  "application/epub+zip",
  "text/csv",
]);

// The browser sends an empty (or generic) type for .xmind and .mm, and .mm becomes
// "Objective-C++ code" on the Mac. For these, the extension decides the stored type.
const materialTypesByExtension: Record<string, string> = {
  epub: "application/epub+zip",
  xmind: "application/vnd.xmind.workbook",
  mm: "application/x-freemind",
};

/**
 * What the `course-content` bucket accepts: types the browser shows without
 * running script, or that it only downloads. SVG, HTML and XML are left out: opened
 * through the signed link, their script ran on the storage domain. Mirror of
 * supabase/migrations/20261008020000_course_content_sem_conteudo_ativo.sql
 * (material-extensions.test.ts checks it).
 */
export const courseContentMimeTypes: readonly string[] = [
  ...new Set([
    ...lessonMaterialMimeTypes,
    ...Object.values(materialTypesByExtension),
    "application/octet-stream",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "text/plain",
    "text/markdown",
    "audio/*",
    "video/*",
  ]),
];

/** Same rule as Storage: the exact type or the family wildcard (`video/*`). */
export function isCourseContentMimeType(type: string): boolean {
  const slash = type.indexOf("/");
  return courseContentMimeTypes.includes(type)
    || (slash > 0 && courseContentMimeTypes.includes(`${type.slice(0, slash)}/*`));
}

const lessonMaterialExtensions = new Set([
  "pdf",
  "txt",
  "md",
  "csv",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "zip",
  "epub",
  "xmind",
  "mm",
  "mp3",
  "m4a",
  "wav",
  "ogg",
]);

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * The type stored on the file and on the row. An empty type broke the upload: the row
 * requires at least 3 letters in content_type, and a .md or .xmind with no browser
 * type fell into the generic error. Outside `courseContentMimeTypes` (SVG,
 * HTML, XML, empty type) it becomes application/octet-stream: the browser downloads it
 * instead of opening it.
 */
export function getCourseAssetContentType(file: File): string {
  const type = materialTypesByExtension[getFileExtension(file.name)] ?? file.type;
  return isCourseContentMimeType(type) ? type : "application/octet-stream";
}

export function isAllowedCourseAssetFile(file: File, kind: CourseAssetKind): boolean {
  // Validates against the cap that actually rejects the upload (the plan's), not against the
  // bucket's. Everything that goes through here goes to Supabase Storage; validating at
  // 500 MB let an 80 MB PNG "pass" on the screen and then fall into a 413.
  if (file.size > supabaseUploadLimitBytes) {
    return false;
  }

  if (kind === "lesson_video" || kind === "live_recording") {
    return file.type.startsWith("video/");
  }

  if (
    kind === "course_cover" ||
    kind === "members_cover" ||
    kind === "module_cover" ||
    kind === "lesson_thumbnail"
  ) {
    return file.type.startsWith("image/");
  }

  return (
    lessonMaterialMimeTypes.has(file.type) ||
    file.type.startsWith("text/") ||
    file.type.startsWith("image/") ||
    file.type.startsWith("audio/") ||
    lessonMaterialExtensions.has(getFileExtension(file.name))
  );
}

export function formatCourseAssetSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Without this branch, the Bunny video cap (5 GiB) was announced to the creator
  // as "5120.0 MB", a number nobody mentally compares with the file
  // you just dragged in.
  return `${(size / (1024 * 1024 * 1024)).toFixed(size % (1024 * 1024 * 1024) === 0 ? 0 : 1)} GB`;
}

// Server-side authorization for minting a signed lesson-video token.
// Defense-in-depth: the /api/courses/video-token route must NOT rely solely on
// course_assets RLS to gate playback — this explicit predicate is the second
// gate, so a missing or permissive RLS policy can't hand a signed embed URL for
// paid content to any signed-in user enumerating assetIds. Entitled when the
// asset is a free preview, the caller owns it (teacher), holds an active/
// completed enrollment in its course, or is a platform admin.
export function canViewCourseAssetVideo(params: {
  isPreview: boolean;
  assetOwnerId: string;
  callerId: string;
  enrollmentStatus: string | null;
  isAdmin: boolean;
}): boolean {
  const { isPreview, assetOwnerId, callerId, enrollmentStatus, isAdmin } = params;
  if (isPreview) return true;
  if (assetOwnerId === callerId) return true;
  if (enrollmentStatus === "active" || enrollmentStatus === "completed") return true;
  return isAdmin;
}

/** Callers supply assets from one course; legacy covers use newest date, then greatest id. */
export function getModuleCoverAsset(
  module: { id: string; coverAssetId?: string | null },
  assets: readonly CourseAsset[],
): CourseAsset | null {
  const covers = assets.filter((asset) => asset.kind === "module_cover" && asset.moduleId === module.id);
  const selected = covers.find((asset) => asset.id === module.coverAssetId);
  if (selected) return selected;

  return covers.reduce<CourseAsset | null>((newest, asset) => {
    if (!newest) return asset;
    const assetDate = Date.parse(String(asset.createdAt ?? ""));
    const newestDate = Date.parse(String(newest.createdAt ?? ""));
    const a = Number.isNaN(assetDate) ? -Infinity : assetDate;
    const b = Number.isNaN(newestDate) ? -Infinity : newestDate;
    return a > b || (a === b && asset.id > newest.id) ? asset : newest;
  }, null);
}

/** Select the newest playable lesson upload; equal or invalid dates stay stable. */
export function getPrimaryLessonVideoAsset(assets: readonly CourseAsset[]): CourseAsset | null {
  return assets
    .filter((asset) => isVideoAssetKind(asset.kind) && asset.contentType.startsWith("video/"))
    .reduce<CourseAsset | null>((newest, asset) => {
      if (!newest) return asset;
      const a = Date.parse(String(asset.createdAt ?? ""));
      const b = Date.parse(String(newest.createdAt ?? ""));
      if (Number.isNaN(a)) return newest;
      if (Number.isNaN(b)) return asset;
      return a > b ? asset : newest;
    }, null);
}
