"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import type { TeacherCourseProductFormat } from "@/domain/teacher-course";

// Each screen is its own chunk: the course list no longer downloads the whole
// course editor (and vice versa).
const loadEditor = () => import("@/components/teacher/course-builder-studio");
const loadList = () => import("@/components/teacher/teacher-course-studio");

const CourseBuilderStudio = dynamic(() => loadEditor().then((m) => m.CourseBuilderStudio));
const TeacherCourseStudio = dynamic(() => loadList().then((m) => m.TeacherCourseStudio));

// The hub only renders once ProtectedSurface has resolved the session, on the
// client. Start fetching the screen this URL needs as soon as this module is
// evaluated, so the chunk downloads alongside the auth check instead of after.
if (typeof window !== "undefined") {
  void (new URLSearchParams(window.location.search).get("courseId") ? loadEditor() : loadList());
}

function parseProductFormat(value: string | null): TeacherCourseProductFormat {
  return value === "program"
    || value === "subscription"
    || value === "community"
    || value === "event"
    || value === "free"
    ? value
    : "course";
}

export function TeacherBuilderHub() {
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId");
  const newCourseRequested = searchParams.get("newCourse") === "1";
  const initialFormat = parseProductFormat(searchParams.get("format"));

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
