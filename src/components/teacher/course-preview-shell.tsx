"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

// A aba que abriu a prévia (rel="opener" nos links do construtor). Guardada
// aqui e window.opener zerado na primeira montagem: deixado de pé, uma página de
// outra origem aberta depois nesta aba poderia trocar o endereço do construtor
// por ele (tabnabbing). Fechar a aba por script não depende de window.opener.
// No módulo, não num ref: trocar de aba da prévia remonta o componente e o
// opener já estaria zerado. undefined = ainda não lida nesta página.
let builderTab: Window | null | undefined;

function takeBuilderTab(): Window | null {
  if (builderTab === undefined) {
    builderTab = (window.opener as Window | null) ?? null;
    window.opener = null;
  }
  return builderTab;
}

// Só fecha esta aba se a de origem ainda estiver aberta, nesta origem, no
// construtor DESTE curso. Fechada, ou já em outro curso ou outra tela, fechar
// deixaria a pessoa sem o construtor (ou na tela errada).
function builderTabOn(courseId: string): Window | null {
  const tab = takeBuilderTab();
  try {
    if (!tab || tab.closed) return null;
    const { origin, pathname, search } = tab.location;
    const sameBuilder = origin === window.location.origin
      && pathname === "/teach/builder"
      && new URLSearchParams(search).get("courseId") === courseId;
    return sameBuilder ? tab : null;
  } catch {
    return null;
  }
}

/**
 * "Exit preview" e "Back" NAVEGAVAM esta aba para o construtor: ficavam dois
 * construtores salvando sozinhos o mesmo curso. Com o construtor deste curso
 * ainda aberto na aba de origem, esta aba fecha e a pessoa volta a ele. Em
 * qualquer outro caso o link segue para o construtor do curso, nesta aba; e se
 * o navegador recusar fechar, a aba vai para lá depois de um instante.
 */
function useLeavePreview(courseId: string) {
  const router = useRouter();
  useEffect(() => {
    takeBuilderTab();
  }, []);
  return (event: MouseEvent<HTMLElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a");
    if (!link || link.getAttribute("href") !== href) return;
    const tab = builderTabOn(courseId);
    if (!tab) return;
    event.preventDefault();
    tab.focus();
    window.close();
    window.setTimeout(() => {
      if (!window.closed) router.push(href);
    }, 150);
  };
}

export function CoursePreviewShell({
  courseId,
  tab = "lesson",
  whitelabel = false,
}: CoursePreviewShellProps) {
  const { t } = useTranslation();
  const leavePreview = useLeavePreview(courseId);
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
    <div className="contents" onClickCapture={(event) => leavePreview(event, exitHref)}>
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
  const leavePreview = useLeavePreview(courseId);
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
        onClick={(event) => leavePreview(event, href)}
        className="button-outline mt-6 px-4 py-2.5 text-sm"
      >
        {t("creatorEditor.preview.back")}
      </Link>
    </section>
  );
}
