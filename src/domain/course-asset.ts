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
  createdAt?: unknown;
  updatedAt?: unknown;
};

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
      "text/*",
      "image/*",
      "audio/*",
    ].join(","),
  lesson_video: "video/*",
  live_recording: "video/*",
};

export const courseAssetMaxBytes = 500 * 1024 * 1024;

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
  "text/csv",
]);

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
  "mp3",
  "m4a",
  "wav",
  "ogg",
]);

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function isAllowedCourseAssetFile(file: File, kind: CourseAssetKind): boolean {
  if (file.size > courseAssetMaxBytes) {
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

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
