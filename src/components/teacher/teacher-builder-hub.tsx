"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { parseTeacherCourseProductFormat } from "@/domain/teacher-course";

// Each screen is its own chunk: the course list no longer downloads the whole
// course editor (and vice versa).
type EditorModule = typeof import("@/components/teacher/course-builder-studio");
type ListModule = typeof import("@/components/teacher/teacher-course-studio");

// Modules already downloaded. React.lazy suspends on its first render even when
// the chunk is cached, which would flash the page's Suspense fallback between
// the auth spinner and the screen; a module that is already here renders
// directly instead.
let editorModule: EditorModule | null = null;
let listModule: ListModule | null = null;

const loadEditor = () =>
  import("@/components/teacher/course-builder-studio").then((m) => (editorModule = m));
const loadList = () =>
  import("@/components/teacher/teacher-course-studio").then((m) => (listModule = m));

const DynamicEditor = dynamic(() => loadEditor().then((m) => m.CourseBuilderStudio));
const DynamicList = dynamic(() => loadList().then((m) => m.TeacherCourseStudio));

// The hub only renders once ProtectedSurface has resolved the session, on the
// client. Start fetching the screen this URL needs as soon as this module is
// evaluated, so the chunk downloads alongside the auth check instead of after.
if (typeof window !== "undefined") {
  void (new URLSearchParams(window.location.search).get("courseId") ? loadEditor() : loadList());
}

export function TeacherBuilderHub() {
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId");
  const newCourseRequested = searchParams.get("newCourse") === "1";
  const initialFormat = parseTeacherCourseProductFormat(searchParams.get("format"));
  // Chosen once per mount: swapping the dynamic wrapper for the direct
  // component later would remount the screen and drop its state.
  const [CourseBuilderStudio] = useState(() => editorModule?.CourseBuilderStudio ?? DynamicEditor);
  const [TeacherCourseStudio] = useState(() => listModule?.TeacherCourseStudio ?? DynamicList);

  // Once this screen is up, fetch the other one while idle, so moving between
  // the list and the editor stays as instant as when both were in one bundle.
  useEffect(() => {
    const other = courseId ? loadList : loadEditor;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1));
    idle(() => void other());
  }, [courseId]);

  if (courseId) {
    return <CourseBuilderStudio />;
  }

  return <TeacherCourseStudio autoOpenCreate={newCourseRequested} initialFormat={initialFormat} />;
}
