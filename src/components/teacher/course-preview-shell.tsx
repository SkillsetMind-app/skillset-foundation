"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";

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

const builderHref = (courseId: string) =>
  courseId ? `/teach/builder?courseId=${encodeURIComponent(courseId)}` : "/teach/builder";

/**
 * A prévia abre numa aba nova pelo construtor (rel="opener" no link). Sair
 * NAVEGAVA esta aba para o construtor: ficavam dois construtores salvando
 * sozinhos o mesmo curso. Aberta pelo construtor, a aba fecha e a pessoa volta
 * ao que já estava aberto. Aberta direto (sem opener), ou se o navegador recusar
 * fechar, o link segue para o construtor do curso como antes.
 */
function closeIfOpenedByBuilder(event: MouseEvent<HTMLElement>, href: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.("a");
  if (!link || link.getAttribute("href") !== href || !window.opener) return;
  window.close();
  if (window.closed) event.preventDefault();
}

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
        courseId=""
        title={t("creatorEditor.preview.notSelected")}
        detail={t("creatorEditor.preview.notSelectedHelp")}
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <PreviewState
        courseId={courseId}
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
    return <PreviewState courseId={courseId} title={t("creatorEditor.preview.unavailable")} detail={t("creatorEditor.preview.loadError")} />;
  }

  if (!course) {
    return (
      <PreviewState
        courseId={courseId}
        title={t("creatorEditor.preview.notFound")}
        detail={t("creatorEditor.preview.notFoundHelp")}
      />
    );
  }

  const exitHref = `${builderHref(course.id)}&tab=members`;
  // O "Exit preview" mora na sala do aluno (learn/), que só recebe o endereço:
  // a captura aqui em volta decide antes do Link. `contents`: o invólucro não
  // entra no layout da sala.
  return (
    <div className="contents" onClickCapture={(event) => closeIfOpenedByBuilder(event, exitHref)}>
      <EnrolledCourseWorkspace
        course={teacherCourseToLearningCourse(course)}
        tab={tab}
        enableFirestoreAssets
        previewExitHref={exitHref}
        previewMode
        whitelabel={whitelabel}
      />
    </div>
  );
}

// Erro e "sem curso": a frase de sempre, sem título de destaque, e a volta é o
// construtor DESTE curso (antes, o início do estúdio).
function PreviewState({ courseId, title, detail }: { courseId: string; title: string; detail: string }) {
  const { t } = useTranslation();
  const href = builderHref(courseId);
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("creatorEditor.preview.mode")}
      </p>
      <h3 className="mt-3 text-lg font-semibold text-[var(--color-ink)]">
        {title}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <Link
        href={href}
        onClick={(event) => closeIfOpenedByBuilder(event, href)}
        className="button-outline mt-6 px-4 py-2.5 text-sm"
      >
        {t("creatorEditor.preview.back")}
      </Link>
    </section>
  );
}
