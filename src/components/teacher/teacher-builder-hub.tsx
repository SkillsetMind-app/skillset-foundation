"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import type { TeacherCourseProductFormat } from "@/domain/teacher-course";

// Each screen is its own chunk: the course list no longer downloads the whole
// course editor (and vice versa). Still server-rendered, and the chunk that
// renders is loaded before hydration, so nothing flashes on a full load.
const CourseBuilderStudio = dynamic(() =>
  import("@/components/teacher/course-builder-studio").then((m) => m.CourseBuilderStudio),
);
const TeacherCourseStudio = dynamic(() =>
  import("@/components/teacher/teacher-course-studio").then((m) => m.TeacherCourseStudio),
);

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

  if (courseId) {
    return <CourseBuilderStudio />;
  }

  return <TeacherCourseStudio autoOpenCreate={newCourseRequested} initialFormat={initialFormat} />;
}
