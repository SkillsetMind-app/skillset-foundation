"use client";

import { useSearchParams } from "next/navigation";

import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import type { TeacherCourseProductFormat } from "@/domain/teacher-course";

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
