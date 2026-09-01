"use client";

import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export const maxAvatarBytes = 5 * 1024 * 1024;

/** Formats every browser can render in an <img>. HEIC is intentionally
 *  excluded because browsers cannot display it without conversion. */
export const allowedAvatarTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const avatarRequirementLabel = "JPG, PNG, or WebP under 5 MB";

export const signatureRequirementLabel =
  "PNG, JPG, or WebP under 5 MB (transparent PNG looks best)";

export const storefrontImageRequirementLabel = "JPG, PNG, or WebP under 5 MB";

export type StorefrontImageKind = "logo" | "hero";

// Mesmo contrato de progresso dos uploads de curso (#138): `percent` é null
// enquanto o transporte não informa nada, e `success` só sai depois de a
// escrita existir. Assim a mesma UploadProgressNote serve às duas famílias.
export type UploadAvatarProgress = UploadCourseAssetProgress;

const publicMediaBucket = "public-media";

export function isAllowedAvatarFile(file: File) {
  return file.size > 0
    && file.size <= maxAvatarBytes
    && (allowedAvatarTypes as readonly string[]).includes(file.type);
}

type OnProgress = ((progress: UploadAvatarProgress) => void) | undefined;

// ponytail: supabase-js upload() exposes no per-byte progress. "running" sai
// sem porcentagem (a UI mostra "Sending..." e o tamanho); um 0% parado o envio
// inteiro se lia como "travou". Cada função exportada emite "success" no fim,
// depois da SUA última escrita — o avatar e a assinatura ainda gravam em
// `users` depois de o objeto subir.
function emitProgress(file: File, state: "running" | "success", onProgress: OnProgress) {
  onProgress?.({
    bytesTransferred: state === "success" ? file.size : 0,
    totalBytes: file.size,
    percent: state === "success" ? 100 : null,
    state,
  });
}

async function uploadUserPublicImage(
  uid: string,
  storageSlot: string,
  file: File,
  onProgress: OnProgress,
) {
  const supabase = getSupabaseBrowserClient();
  const storagePath = `users/${uid}/${storageSlot}`;
  emitProgress(file, "running", onProgress);

  const { error: uploadError } = await supabase.storage
    .from(publicMediaBucket)
    .upload(storagePath, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    throw uploadError;
  }

  const publicUrl = supabase.storage
    .from(publicMediaBucket)
    .getPublicUrl(storagePath).data.publicUrl;

  return `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
}

export async function uploadUserAvatar(
  uid: string,
  file: File,
  onProgress?: (progress: UploadAvatarProgress) => void,
) {
  if (!isAllowedAvatarFile(file)) {
    throw new Error(`Use a ${avatarRequirementLabel} image.`);
  }

  // Canonical, deterministic object key: every upload overwrites the same
  // object (upsert), so a user holds at most one avatar. The public URL is
  // cache-busted with ?v= below.
  const photoUrl = await uploadUserPublicImage(
    uid,
    "avatar/avatar",
    file,
    onProgress,
  );
  const supabase = getSupabaseBrowserClient();

  const { error: updateError } = await supabase
    .from("users")
    .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
    .eq("uid", uid);

  if (updateError) {
    throw updateError;
  }

  emitProgress(file, "success", onProgress);
  return photoUrl;
}

/**
 * Uploads a teacher's handwritten-signature image and stores its URL on
 * `users.teacher_signature_url`. The certificate issuance RPC reads this value
 * and snapshots it onto each issued credential.
 */
export async function uploadTeacherSignature(
  uid: string,
  file: File,
  onProgress?: (progress: UploadAvatarProgress) => void,
) {
  if (!isAllowedAvatarFile(file)) {
    throw new Error(`Use a ${signatureRequirementLabel} image.`);
  }

  const teacherSignatureUrl = await uploadUserPublicImage(
    uid,
    "signature/signature",
    file,
    onProgress,
  );
  const supabase = getSupabaseBrowserClient();

  const { error: updateError } = await supabase
    .from("users")
    .update({
      teacher_signature_url: teacherSignatureUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("uid", uid);

  if (updateError) {
    throw updateError;
  }

  emitProgress(file, "success", onProgress);
  return teacherSignatureUrl;
}

export async function uploadUserStorefrontImage(
  uid: string,
  kind: StorefrontImageKind,
  file: File,
  onProgress?: (progress: UploadAvatarProgress) => void,
) {
  if (!isAllowedAvatarFile(file)) {
    throw new Error(`Use a ${storefrontImageRequirementLabel} image.`);
  }

  // Aqui a única escrita é o objeto no Storage: a URL só vai para o perfil
  // quando o professor salva a vitrine.
  const url = await uploadUserPublicImage(
    uid,
    `storefront/${kind}/${kind}`,
    file,
    onProgress,
  );
  emitProgress(file, "success", onProgress);
  return url;
}

export async function removeUserStorefrontImage(
  uid: string,
  kind: StorefrontImageKind,
) {
  const supabase = getSupabaseBrowserClient();
  const storagePath = `users/${uid}/storefront/${kind}/${kind}`;
  const { error } = await supabase.storage
    .from(publicMediaBucket)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
}
