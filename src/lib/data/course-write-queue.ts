"use client";

import type { TeacherCourseModule, TeacherLesson } from "@/domain/teacher-course";

const videoSelections = new Map<string, Map<string, TeacherLesson["videoSource"]>>();
export function recordLessonVideoSelection(courseId: string, lessonId: string, source: TeacherLesson["videoSource"]) {
  const selections = videoSelections.get(courseId) ?? new Map();
  selections.set(lessonId, source);
  videoSelections.set(courseId, selections);
}
export function clearLessonVideoSelection(courseId: string, lessonId: string) {
  videoSelections.get(courseId)?.delete(lessonId);
}
export function reconcileLessonVideoSelections(courseId: string, modules: TeacherCourseModule[]) {
  const selections = videoSelections.get(courseId);
  if (!selections) return modules;
  return modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) =>
    selections.has(lesson.id) ? { ...lesson, videoSource: selections.get(lesson.id) } : lesson,
  ) }));
}

// Serialize this tab's autosaves and upload finalization without blocking other courses.
const pending = new Map<string, Promise<unknown>>();
let sessionVersion = 0;
export function invalidateCourseWrites() { sessionVersion += 1; videoSelections.clear(); }
export async function runCourseWrite<T>(courseId: string, write: () => Promise<T>): Promise<T> {
  const version = sessionVersion;
  const previous = pending.get(courseId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => {
    if (version !== sessionVersion) throw new Error("The account changed before saving. Reopen the course.");
    return write();
  });
  pending.set(courseId, next);
  try {
    return await next;
  } finally {
    if (pending.get(courseId) === next) pending.delete(courseId);
  }
}
