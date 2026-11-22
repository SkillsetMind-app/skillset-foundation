"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import type { TeacherCourse } from "@/domain/teacher-course";
import { teacherCourseToLearningCourse } from "@/lib/data/published-courses";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

type CoursePreviewShellProps = {
  courseId: string;
  tab?: ClassroomTab;
  /** Teacher's plan hides our brand: drop the platform links from the preview
   *  too, so it matches what their students actually see. */
  whitelabel?: boolean;
};

export function CoursePreviewShell({
  courseId,
  tab = "lesson",
  whitelabel = false,
}: CoursePreviewShellProps) {
  const { t } = useTranslation();
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const shouldLoadCourse = Boolean(courseId && hasBackendConfig);
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [isLoading, setIsLoading] = useState(shouldLoadCourse);
  const [hasLoadError, setHasLoadError] = useState(false);

  useEffect(() => {
    if (!shouldLoadCourse) {
      return;
    }

    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setCourse(nextCourse);
        setHasLoadError(false);
        setIsLoading(false);
      },
      () => {
        setHasLoadError(true);
        setIsLoading(false);
      },
    );
  }, [courseId, shouldLoadCourse]);

  if (!courseId) {
    return (
      <PreviewState
        title={t("creatorEditor.preview.notSelected")}
        detail={t("creatorEditor.preview.notSelectedHelp")}
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <PreviewState
        title={t("creatorEditor.preview.disconnected")}
        detail={t("creatorEditor.preview.disconnectedHelp")}
      />
    );
  }

  // O mesmo cartão escuro do fallback da rota, com a mesma frase: antes a
  // espera trocava dele para um cartão branco com "PREVIEW MODE", um título de
  // 30px "Loading preview..." e um botão de voltar — três telas até a prévia.
  if (isLoading) {
    return (
      <section role="status" className="rounded-lg border border-[var(--ma-line)] bg-[var(--ma-surface)] p-6">
        <p className="text-sm text-[var(--ma-ink-soft)]">{t("creatorEditor.preview.serverLoading")}</p>
      </section>
    );
  }

  if (hasLoadError) {
    return <PreviewState title={t("creatorEditor.preview.unavailable")} detail={t("creatorEditor.preview.loadError")} />;
  }

  if (!course) {
    return (
      <PreviewState
        title={t("creatorEditor.preview.notFound")}
        detail={t("creatorEditor.preview.notFoundHelp")}
      />
    );
  }

  return (
    <EnrolledCourseWorkspace
      course={teacherCourseToLearningCourse(course)}
      tab={tab}
      enableFirestoreAssets
      previewExitHref={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=members`}
      previewMode
      whitelabel={whitelabel}
    />
  );
}

function PreviewState({ title, detail }: { title: string; detail: string }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("creatorEditor.preview.mode")}
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <Link href="/teach" className="button-outline mt-6 px-4 py-2.5 text-sm">
        {t("creatorEditor.preview.back")}
      </Link>
    </section>
  );
}
