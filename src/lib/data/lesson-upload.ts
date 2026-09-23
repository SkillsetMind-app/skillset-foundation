"use client";

import type { CourseAssetKind } from "@/domain/course-asset";
import {
  CourseAssetUploadCancelled,
  uploadCourseAsset,
  uploadLessonVideoToBunny,
  type UploadCourseAssetProgress,
} from "./course-assets";
import { activateUploadedLessonVideo } from "./lesson-video-selection";
import { invalidateCourseWrites } from "./course-write-queue";

export type LessonUpload = {
  actorId: string;
  courseId: string;
  ownerId: string;
  lessonId: string;
  moduleId: string;
  fileName: string;
  kind: CourseAssetKind;
  status: "uploading" | "connecting" | "success" | "error" | "cancelled";
  progress: UploadCourseAssetProgress | null;
  canCancel?: boolean;
  assetId?: string;
  error?: unknown;
};

// One upload per browser tab; bytes and status outlive the editor component.
let current: LessonUpload | null = null;
let actor: string | null = null;
let generation = 0;
let abort: (() => void) | null = null;
const listeners = new Set<() => void>();
export const getLessonUpload = () => current;
export const getServerLessonUpload = () => null;
export const subscribeLessonUpload = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const lessonUploadIsBusy = (job: LessonUpload | null) => job?.status === "uploading" || job?.status === "connecting";

function publish(job: LessonUpload | null) {
  current = job;
  listeners.forEach((listener) => listener());
}

export function setLessonUploadActor(next: string | null) {
  if (actor === next) return;
  actor = next;
  invalidateCourseWrites();
  generation += 1;
  const cancel = abort;
  abort = null;
  publish(null);
  cancel?.();
}

export function dismissLessonUpload() {
  if (!lessonUploadIsBusy(current)) publish(null);
}

export function cancelLessonUpload() {
  if (current?.status !== "uploading" || !abort) return;
  generation += 1;
  const cancel = abort;
  abort = null;
  publish({ ...current, status: "cancelled", progress: null, canCancel: false });
  cancel?.();
}

async function connect(job: LessonUpload, ticket: number) {
  if (ticket !== generation || actor !== job.actorId) throw new CourseAssetUploadCancelled();
  publish({ ...job, status: "connecting", canCancel: false });
  if (job.kind === "lesson_video" || job.kind === "live_recording") {
    await activateUploadedLessonVideo(job.courseId, job.lessonId, job.assetId!, () => {
      if (ticket !== generation || actor !== job.actorId) throw new CourseAssetUploadCancelled();
    });
  }
  if (ticket !== generation || actor !== job.actorId) throw new CourseAssetUploadCancelled();
  publish({ ...job, status: "success", progress: null, error: undefined });
}

export async function retryLessonVideoConnection() {
  const job = current;
  if (!job?.assetId || job.status !== "error" || actor !== job.actorId) return;
  const ticket = generation;
  try {
    await connect(job, ticket);
  } catch (error) {
    if (ticket === generation) publish({ ...job, status: "error", error });
  }
}

export async function startLessonUpload(input: {
  actorId: string; courseId: string; ownerId: string; lessonId: string; moduleId: string;
  kind: CourseAssetKind; file: File; isPreview: boolean; useBunny: boolean;
}) {
  if (actor !== input.actorId) throw new Error("Sign in again before uploading.");
  if (lessonUploadIsBusy(current) || current?.status === "error") throw new Error("Finish or dismiss the previous upload first.");
  const ticket = ++generation;
  const job: LessonUpload = {
    actorId: input.actorId, courseId: input.courseId, ownerId: input.ownerId,
    lessonId: input.lessonId, moduleId: input.moduleId, kind: input.kind,
    fileName: input.file.name, status: "uploading", progress: null,
  };
  const check = () => {
    if (ticket !== generation || actor !== input.actorId) throw new CourseAssetUploadCancelled();
  };
  publish(job);
  const transport = {
    ...input,
    beforeCommit: () => {
      check();
      // Bytes are already sent. Do not offer cancellation during database commit.
      publish({ ...current!, status: "connecting", canCancel: false });
    },
    onProgress: (progress: UploadCourseAssetProgress) => {
      if (ticket === generation) publish({ ...current!, progress });
    },
    onCancelAvailable: (cancel: () => void) => {
      if (ticket !== generation) cancel();
      else {
        abort = cancel;
        publish({ ...current!, canCancel: true });
      }
    },
  };
  try {
    const assetId = input.useBunny && (input.kind === "lesson_video" || input.kind === "live_recording")
      ? await uploadLessonVideoToBunny({ ...transport, kind: input.kind })
      : await uploadCourseAsset(transport);
    check();
    job.assetId = assetId;
    await connect(job, ticket);
    return assetId;
  } catch (error) {
    if (ticket === generation) publish({ ...job, status: error instanceof CourseAssetUploadCancelled ? "cancelled" : "error", error, progress: null });
    throw error;
  } finally {
    if (ticket === generation) abort = null;
  }
}
