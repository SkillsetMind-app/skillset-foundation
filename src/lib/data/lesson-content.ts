"use client";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase/client";

/**
 * B1 — paywalled lesson content moved OUT of the world-readable course doc into
 * the enrollment-gated subcollection courses/{courseId}/lessonContent/{lessonId}.
 * Doc shape is locked by firestore.rules to exactly these two keys; the backfill
 * (functions/scripts/backfill-lesson-content.mjs) and the dual-write below both
 * write the identical shape so the subcollection copy is always a faithful
 * mirror of the inline fields.
 */
export type LessonContent = {
  contentText: string | null;
  externalUrl: string | null;
};

const coursesCollection = "courses";
const lessonContentCollection = "lessonContent";

/**
 * Realtime subscription to every lesson's gated content for a course, keyed by
 * lessonId. Consumers (enrolled workspace) merge this onto the matching lesson,
 * preferring the subcollection value and falling back to the inline field when
 * a doc is absent (un-migrated course during transition). Mirrors the
 * subscribeToCourseAssets onSnapshot style.
 */
export function subscribeToLessonContent(
  courseId: string,
  callback: (content: Map<string, LessonContent>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(
      getFirestoreDb(),
      coursesCollection,
      courseId,
      lessonContentCollection,
    ),
    (snapshot) => {
      const next = new Map<string, LessonContent>();

      for (const document of snapshot.docs) {
        const data = document.data() as Partial<LessonContent>;
        next.set(document.id, {
          contentText: data.contentText ?? null,
          externalUrl: data.externalUrl ?? null,
        });
      }

      callback(next);
    },
    onError,
  );
}

/**
 * One-shot read of a single lesson's gated content. Used by the public
 * free-preview surface, where the firestore.rules `freePreviewLessonId` branch
 * allows an unauthenticated visitor to read exactly the preview lesson's doc.
 * Returns null when the doc is absent so the caller falls back to inline.
 */
export async function getLessonContentDoc(
  courseId: string,
  lessonId: string,
): Promise<LessonContent | null> {
  const snapshot = await getDoc(
    doc(
      getFirestoreDb(),
      coursesCollection,
      courseId,
      lessonContentCollection,
      lessonId,
    ),
  );

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data() as Partial<LessonContent>;
  return {
    contentText: data.contentText ?? null,
    externalUrl: data.externalUrl ?? null,
  };
}

/**
 * Resolve a lesson's effective content: prefer the gated subcollection value,
 * fall back to the inline field when the subcollection doc is absent. Shared by
 * the enrolled workspace and the public preview so the merge rule is identical
 * everywhere.
 */
export function resolveLessonContent(
  subcollection: LessonContent | undefined,
  inline: { contentText?: string | null; externalUrl?: string | null },
): LessonContent {
  if (subcollection) {
    return subcollection;
  }

  return {
    contentText: inline.contentText ?? null,
    externalUrl: inline.externalUrl ?? null,
  };
}
