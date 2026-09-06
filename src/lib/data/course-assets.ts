"use client";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  courseAssetUploadLimitMessage,
  isAllowedCourseAssetFile,
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
  // null quando o transporte não informa progresso (supabase-js upload()). A UI
  // mostra "enviando" sem número em vez de uma barra parada em 0%.
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

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, input.file, {
      contentType: input.file.type,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

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

  // "success" só depois de a linha existir e a capa estar gravada. Emitido
  // antes, uma falha no insert deixava "Upload complete 100%" na tela ao lado
  // da caixa vermelha dizendo que não foi possível enviar.
  input.onProgress?.({
    bytesTransferred: input.file.size,
    totalBytes: input.file.size,
    percent: 100,
    state: "success",
  });

  return assetId;
}

/**
 * Lançado quando o próprio criador cancela o envio. É um desfecho normal, não
 * uma falha: quem chama deve limpar o estado sem mostrar mensagem de erro.
 */
export class CourseAssetUploadCancelled extends Error {
  constructor() {
    super("upload-cancelled");
    this.name = "CourseAssetUploadCancelled";
  }
}

type UploadBunnyVideoInput = {
  courseId: string;
  ownerId: string;
  kind: "lesson_video" | "live_recording";
  file: File;
  isPreview: boolean;
  lessonId: string;
  onProgress?: (progress: UploadCourseAssetProgress) => void;
  /**
   * Recebe a função de cancelamento assim que o envio começa. Sem isto a
   * instância do tus ficava presa dentro do executor da Promise e
   * `upload.abort()` era inalcançável — não havia como cancelar um envio em
   * andamento a não ser fechando a aba.
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
    });
  }

  if (createRes.status === 402) {
    // The route's activation guard. Carry the gate's own wording out of here
    // instead of "bunny-create-failed:402" — every caller matches on the
    // wording, and a status code in an error string is not something a
    // creator can act on.
    throw new Error(
      "Pay the one-time activation fee before uploading course video.",
    );
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
  // A instância do Upload precisa escapar do executor: antes ela nascia e morria
  // aqui dentro, então `upload.abort()` era inalcançável e não havia como
  // cancelar. Quem escolhia o arquivo errado de 4 GB, ou travava numa conexão
  // ruim, só tinha a saída de fechar a aba — e aí nada retomava, o próximo
  // envio recomeçava do zero e sobrava um vídeo órfão no Bunny.
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

    // Entrega o cancelador a quem chamou. `abort` do tus devolve uma promise;
    // ignorá-la é aceitável porque o resultado que interessa é a rejeição
    // abaixo, que devolve o controle da UI imediatamente.
    input.onCancelAvailable?.(() => {
      void upload.abort();
      reject(new CourseAssetUploadCancelled());
    });

    upload.start();
  });

  // 3. Record the asset (no Storage object; storage_path is a marker only).
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

  // Mesma regra do caminho Supabase: concluído é só quando a linha existe.
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

  return (data ?? [])
    .map(rowToCourseAsset)
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function subscribeToCourseAssets(
  courseId: string,
  callback: (assets: CourseAsset[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    try {
      callback(await fetchCourseAssets(courseId));
    } catch (error) {
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
/**
 * Alinha a flag is_preview dos vídeos do curso com a aula escolhida como prévia
 * gratuita.
 *
 * A busca anônima que alimenta a página pública de vendas filtra por
 * `.eq("is_preview", true)` (src/app/api/courses/video-token/route.ts). Marcar a
 * aula como prévia no builder só mexia num campo do curso, então um vídeo já
 * enviado nunca ganhava a flag e a loja respondia "Video unavailable" — com o
 * estúdio mostrando tudo pronto.
 *
 * Limpa a flag dos vídeos das outras aulas na mesma passagem: prévia é uma só, e
 * trocar de aula tem de despublicar a anterior, senão o curso vai acumulando
 * vídeos pagos abertos ao público.
 */
export async function syncLessonPreviewAssets(
  courseId: string,
  previewLessonId: string,
) {
  const supabase = getSupabaseBrowserClient();
  const videoKinds = ["lesson_video", "live_recording"];

  // Desmarca todo vídeo que não seja da aula de prévia (inclui o caso de
  // previewLessonId vazio, que é "nenhuma prévia").
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
