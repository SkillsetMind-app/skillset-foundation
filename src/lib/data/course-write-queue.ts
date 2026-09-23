"use client";

import type { TeacherCourseModule, TeacherLesson } from "@/domain/teacher-course";

const videoSelections = new Map<string, Map<string, { source: TeacherLesson["videoSource"]; revision: number }>>();
function revisionTime(value: string) {
  // Postgres timestamps retain microseconds; Date.parse alone drops the last three digits.
  const fraction = (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  return Date.parse(value) * 1000 + Number(fraction.slice(3, 6));
}
export function recordLessonVideoSelection(courseId: string, lessonId: string, source: TeacherLesson["videoSource"], revision = new Date().toISOString()) {
  const selections = videoSelections.get(courseId) ?? new Map();
  selections.set(lessonId, { source, revision: revisionTime(revision) });
  videoSelections.set(courseId, selections);
}
// A newer server choice supersedes this tab's completed upload, including other tabs.
export function observeLessonVideoSelections(courseId: string, modules: TeacherCourseModule[], revision: string | null) {
  const selections = videoSelections.get(courseId);
  if (!selections || !revision) return;
  const lessons = modules.flatMap((module) => module.lessons);
  for (const [lessonId, selection] of selections) {
    const lesson = lessons.find((item) => item.id === lessonId);
    if (revisionTime(revision) > selection.revision && lesson?.videoSource !== selection.source) selections.delete(lessonId);
  }
  if (!selections.size) videoSelections.delete(courseId);
}
export function clearLessonVideoSelection(courseId: string, lessonId: string) {
  videoSelections.get(courseId)?.delete(lessonId);
}
export function reconcileLessonVideoSelections(courseId: string, modules: TeacherCourseModule[]) {
  const selections = videoSelections.get(courseId);
  if (!selections) return modules;
  return modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) =>
    selections.has(lesson.id) ? { ...lesson, videoSource: selections.get(lesson.id)!.source } : lesson,
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
