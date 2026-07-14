"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { TeacherCourse } from "@/domain/teacher-course";
import { teacherCourseToLearningCourse } from "@/lib/data/published-courses";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

type CoursePreviewShellProps = {
  courseId: string;
};

export function CoursePreviewShell({ courseId }: CoursePreviewShellProps) {
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const shouldLoadCourse = Boolean(courseId && hasBackendConfig);
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [isLoading, setIsLoading] = useState(shouldLoadCourse);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!shouldLoadCourse) {
      return;
    }

    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setCourse(nextCourse);
        setIsLoading(false);
      },
      () => {
        setError("We could not load this course preview.");
        setIsLoading(false);
      },
    );
  }, [courseId, shouldLoadCourse]);

  if (!courseId) {
    return (
      <PreviewState
        title="Course not selected."
        detail="Return to the builder and open preview from a specific course."
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <PreviewState
        title="Preview is not connected."
        detail="Backend configuration is required before course previews can load."
      />
    );
  }

  if (isLoading) {
    return (
      <PreviewState
        title="Loading preview..."
        detail="SkillsetMind is preparing the student-facing members area."
      />
    );
  }

  if (error) {
    return <PreviewState title="Preview unavailable." detail={error} />;
  }

  if (!course) {
    return (
      <PreviewState
        title="Course record not found."
        detail="The course may have been deleted or your session may need refresh."
      />
    );
  }

  return (
    <EnrolledCourseWorkspace
      course={teacherCourseToLearningCourse(course)}
      enableFirestoreAssets
      previewExitHref={`/teach/builder?courseId=${course.id}`}
      previewMode
    />
  );
}

function PreviewState({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Preview mode
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <Link href="/teach" className="button-outline mt-6 px-4 py-2.5 text-sm">
        Back to Teacher Studio
      </Link>
    </section>
  );
}
