"use client";

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

export type UploadAvatarProgress = {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
};

const publicMediaBucket = "public-media";

export function isAllowedAvatarFile(file: File) {
  return file.size > 0
    && file.size <= maxAvatarBytes
    && (allowedAvatarTypes as readonly string[]).includes(file.type);
}

// ponytail: supabase-js upload() exposes no per-byte progress, so callers get a
// coarse 0% -> 100% pair. Fine for a <=5 MB avatar/signature.
function emitCoarseProgress(
  size: number,
  onProgress?: (progress: UploadAvatarProgress) => void,
) {
  onProgress?.({ bytesTransferred: 0, totalBytes: size, percent: 0 });
}

async function uploadUserPublicImage(
  uid: string,
  storageSlot: string,
  file: File,
  onProgress?: (progress: UploadAvatarProgress) => void,
) {
  const supabase = getSupabaseBrowserClient();
  const storagePath = `users/${uid}/${storageSlot}`;
  emitCoarseProgress(file.size, onProgress);

  const { error: uploadError } = await supabase.storage
    .from(publicMediaBucket)
    .upload(storagePath, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    throw uploadError;
  }

  onProgress?.({
    bytesTransferred: file.size,
    totalBytes: file.size,
    percent: 100,
  });

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

  return uploadUserPublicImage(
    uid,
    `storefront/${kind}/${kind}`,
    file,
    onProgress,
  );
}
