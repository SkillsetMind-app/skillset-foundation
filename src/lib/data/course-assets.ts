"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import {
  deleteObject,
  getBlob,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import { isAllowedCourseAssetFile } from "@/domain/course-asset";
import { getFirebaseStorage, getFirestoreDb } from "@/lib/firebase/client";

const coursesCollection = "courses";
const assetsCollection = "assets";
// members_cover is decorative hero art shown to enrolled students (like the
// public course_cover), not gated content — so it gets a downloadUrl the
// builder preview and the student hero can render directly by assetId.
const publicDownloadKinds = new Set<CourseAssetKind>([
  "course_cover",
  "members_cover",
]);

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

  const assetId = createAssetId();
  const safeFileName = sanitizeFileName(input.file.name);
  const storagePath = `courses/${input.courseId}/assets/${input.ownerId}/${assetId}/${safeFileName}`;
  const storageRef = ref(getFirebaseStorage(), storagePath);
  const assetDoc = doc(
    getFirestoreDb(),
    coursesCollection,
    input.courseId,
    assetsCollection,
    assetId,
  );
  const courseDoc = doc(getFirestoreDb(), coursesCollection, input.courseId);

  try {
    const uploadTask = uploadBytesResumable(storageRef, input.file, {
      contentType: input.file.type,
      customMetadata: {
        courseId: input.courseId,
        ownerId: input.ownerId,
        kind: input.kind,
        lessonId: input.lessonId ?? "",
        moduleId: input.moduleId ?? "",
      },
    });

    await new Promise<void>((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        (snapshot) => {
          input.onProgress?.({
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            percent: Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
            ),
            state: snapshot.state === "paused" ? "paused" : "running",
          });
        },
        reject,
        () => {
          input.onProgress?.({
            bytesTransferred: input.file.size,
            totalBytes: input.file.size,
            percent: 100,
            state: "success",
          });
          resolve();
        },
      );
    });
    const downloadUrl = publicDownloadKinds.has(input.kind)
      ? await getDownloadURL(storageRef)
      : null;

    await setDoc(assetDoc, {
      id: assetId,
      courseId: input.courseId,
      ownerId: input.ownerId,
      kind: input.kind,
      fileName: input.file.name,
      contentType: input.file.type,
      size: input.file.size,
      storagePath,
      downloadUrl,
      isPreview: input.isPreview,
      lessonId: input.lessonId ?? null,
      moduleId: input.moduleId ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (input.kind === "course_cover") {
      await updateDoc(courseDoc, {
        coverImageUrl: downloadUrl,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    await deleteObject(storageRef).catch(() => undefined);
    throw error;
  }

  return assetId;
}

export async function getProtectedCourseAssetObjectUrl(asset: CourseAsset) {
  const blob = await getBlob(ref(getFirebaseStorage(), asset.storagePath));

  return URL.createObjectURL(blob);
}

export function subscribeToCourseAssets(
  courseId: string,
  callback: (assets: CourseAsset[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirestoreDb(), coursesCollection, courseId, assetsCollection),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CourseAsset, "id">),
          }))
          .sort((left, right) => left.fileName.localeCompare(right.fileName)),
      );
    },
    onError,
  );
}

/**
 * Remove a course asset so a wrong video/PDF/cover is never stuck. Deletes the
 * Storage object and the Firestore record, and clears the course cover when the
 * asset being removed is the one currently in use. Owner only (enforced by
 * firestore.rules assets delete == teacherCanManageCourseAssets), so callers
 * must guard the UI behind an editable course state.
 */
export async function deleteCourseAsset(asset: CourseAsset) {
  const db = getFirestoreDb();

  // Drop the Storage blob first; a missing object must not block clearing the
  // Firestore record (otherwise a half-deleted asset would be unremovable).
  await deleteObject(ref(getFirebaseStorage(), asset.storagePath)).catch(
    () => undefined,
  );

  await deleteDoc(
    doc(db, coursesCollection, asset.courseId, assetsCollection, asset.id),
  );

  if (asset.kind === "course_cover") {
    const courseRef = doc(db, coursesCollection, asset.courseId);
    const courseSnapshot = await getDoc(courseRef);

    // Only clear the cover when this asset is the one currently shown, so
    // deleting an older cover never wipes a newer one.
    if (
      courseSnapshot.exists()
      && courseSnapshot.data().coverImageUrl === asset.downloadUrl
    ) {
      await updateDoc(courseRef, {
        coverImageUrl: null,
        updatedAt: serverTimestamp(),
      });
    }
  }
}
