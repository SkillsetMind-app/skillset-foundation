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

// Quais kinds contam como "o vídeo da aula". A comparação literal estava aberta
// em cinco lugares (rótulo de status, filtro de assets, gravação da fonte após o
// envio, escolha do player); um sexto kind de vídeo teria que ser lembrado em
// todos eles, e esquecer um significa a fonte parar de ser declarada em silêncio.
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
): string {
  return `This file exceeds the current upload limit (~${formatCourseAssetSize(limitBytes)}). Use a YouTube link or a smaller file.`;
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
): string {
  const status = readUploadErrorStatus(error);
  const message = error instanceof Error ? error.message : "";

  if (
    status === 413 ||
    /exceeded the maximum allowed size|payload too large|exceeds the current upload limit/i.test(
      message,
    )
  ) {
    // A pre-flight limit error already carries the right limit in its message.
    return /exceeds the current upload limit/i.test(message)
      ? message
      : courseAssetUploadLimitMessage(limitBytes);
  }

  if (
    status === 403 ||
    /row-level security|not authorized|permission/i.test(message)
  ) {
    return "You do not have permission to upload files to this course.";
  }

  // Falhas do provedor de vídeo chegavam como `bunny-create-failed:<status>` e
  // eram impressas cruas na caixa vermelha do estúdio. O criador lia
  // "bunny-create-failed:429" sem nenhuma pista de que bastava esperar.
  const bunnyStatus = /bunny-create-failed:(\d{3})/.exec(message)?.[1];
  if (bunnyStatus) {
    if (bunnyStatus === "429") {
      return "Too many uploads in the last hour. Wait a little and try again — nothing was lost.";
    }
    if (bunnyStatus === "401" || bunnyStatus === "419") {
      return "Your session expired. Sign in again and re-send the file.";
    }
    if (bunnyStatus === "403") {
      return "You do not have permission to upload video to this course.";
    }
    return "Our video service did not accept the file just now. Try again in a few minutes.";
  }

  // tus (upload retomável) lança DetailedError, cuja mensagem é um parágrafo de
  // método, URL e offset. Detecta pela forma, já que não expõe `status`.
  if (
    error
    && typeof error === "object"
    && ("originalRequest" in error || "originalResponse" in error)
  ) {
    return "The upload was interrupted — usually the connection dropped. Check your internet and send the file again.";
  }

  // Última linha de defesa: nunca devolver texto que só faz sentido para quem
  // escreveu o código.
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
  // Valida contra o teto que de fato recusa o envio (o do plano), não contra o
  // do bucket. Tudo que passa por aqui vai para o Supabase Storage; validar em
  // 500 MB deixava um PNG de 80 MB "passar" na tela e cair num 413 em seguida.
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

  // Sem este ramo, o teto de vídeo do Bunny (5 GiB) era anunciado ao criador
  // como "5120.0 MB" — um número que ninguém compara mentalmente com o arquivo
  // que acabou de arrastar.
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
