"use client";

import { updateProfile } from "firebase/auth";
import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

import { getFirebaseAuth, getFirebaseStorage, getFirestoreDb } from "@/lib/firebase/client";

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

export type UploadAvatarProgress = {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
};

export function isAllowedAvatarFile(file: File) {
  return file.size > 0
    && file.size <= maxAvatarBytes
    && (allowedAvatarTypes as readonly string[]).includes(file.type);
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
  // object, so a user holds at most one avatar (storage.rules pins writes to
  // this exact filename). The download URL is cache-busted with ?v= below.
  const storagePath = `users/${uid}/avatar/avatar`;
  const storageRef = ref(getFirebaseStorage(), storagePath);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      uid,
      kind: "profile_avatar",
    },
  });

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        onProgress?.({
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          percent: Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
          ),
        });
      },
      reject,
      resolve,
    );
  });

  const downloadURL = await getDownloadURL(storageRef);
  const photoURL = `${downloadURL}${downloadURL.includes("?") ? "&" : "?"}v=${Date.now()}`;

  await updateDoc(doc(getFirestoreDb(), "users", uid), {
    photoURL,
    updatedAt: serverTimestamp(),
  });

  const currentUser = getFirebaseAuth().currentUser;

  if (currentUser?.uid === uid) {
    try {
      await updateProfile(currentUser, { photoURL });
    } catch (error) {
      // Non-fatal: Firestore is the source of truth for the rendered avatar
      // (see mapFirebaseUser). The Auth photoURL is only a secondary mirror,
      // so a failure here must not lose the already-persisted upload — but it
      // must be visible, never swallowed.
      console.error(
        "uploadUserAvatar: failed to mirror photoURL to Firebase Auth",
        { uid },
        error,
      );
    }
  }

  return photoURL;
}

/**
 * Uploads a teacher's handwritten-signature image and stores its URL on
 * `users/{uid}.teacherSignatureUrl`. The certificate issuance function reads
 * this value and snapshots it onto each issued credential. Unlike the avatar,
 * there is no Firebase Auth mirror — the signature is profile-only data.
 */
export async function uploadTeacherSignature(
  uid: string,
  file: File,
  onProgress?: (progress: UploadAvatarProgress) => void,
) {
  if (!isAllowedAvatarFile(file)) {
    throw new Error(`Use a ${signatureRequirementLabel} image.`);
  }

  // Canonical, deterministic object key (overwrite-on-upload; storage.rules
  // pins writes to this exact filename). Cache-busted with ?v= below.
  const storagePath = `users/${uid}/signature/signature`;
  const storageRef = ref(getFirebaseStorage(), storagePath);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      uid,
      kind: "teacher_signature",
    },
  });

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        onProgress?.({
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          percent: Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
          ),
        });
      },
      reject,
      resolve,
    );
  });

  const downloadURL = await getDownloadURL(storageRef);
  const teacherSignatureUrl = `${downloadURL}${downloadURL.includes("?") ? "&" : "?"}v=${Date.now()}`;

  await updateDoc(doc(getFirestoreDb(), "users", uid), {
    teacherSignatureUrl,
    updatedAt: serverTimestamp(),
  });

  return teacherSignatureUrl;
}
