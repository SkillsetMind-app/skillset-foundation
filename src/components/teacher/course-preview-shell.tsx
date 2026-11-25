"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";

import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
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

// The tab that opened the preview (rel="opener" on the builder's links). Kept
// here and window.opener cleared on the first mount: left standing, a page from
// another origin opened later in this tab could swap the builder's address
// for its own (tabnabbing). Closing the tab by script does not depend on window.opener.
// In the module, not in a ref: switching the preview's tab remounts the component and the
// opener would already be cleared. undefined = not read yet on this page.
let builderTab: Window | null | undefined;

function takeBuilderTab(): Window | null {
  if (builderTab === undefined) {
    builderTab = (window.opener as Window | null) ?? null;
    window.opener = null;
  }
  return builderTab;
}

// Only closes this tab if the origin one is still open, on this origin, on the
// builder of THIS course. If it is closed, or already on another course or screen, closing
// would leave the person without the builder (or on the wrong screen).
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
 * "Exit preview" and "Back" used to NAVIGATE this tab to the builder: two
 * builders ended up saving the same course on their own. With this course's builder
 * still open in the origin tab, this tab closes and the person goes back to it. In
 * any other case the link goes to the course's builder, in this tab; and if
 * the browser refuses to close, the tab goes there after a moment.
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
    // "Try again" on the failure: subscribes to the same course again (F-11).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!shouldLoadCourse) {
      return;
    }

        // `attempt` in the dependencies: each "Try again" closes the subscription and opens another.
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
  }, [courseId, shouldLoadCourse, attempt]);

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

    // The wait of the learner's classroom (the same as the route's fallback and the classroom's own,
    // with the same sentence): before it was a card with a sentence, and the classroom switched
    // to its own blocks right after — two waits that looked different (F-03).
  if (isLoading) {
    return <ClassroomLoading label={t("learnWave2.courseLoading.title")} />;
  }

  if (hasLoadError) {
    return (
      <PreviewState
        courseId={courseId}
        title={t("creatorEditor.preview.unavailable")}
        detail={t("creatorEditor.preview.loadError")}
        onRetry={() => {
          setHasLoadError(false);
          setIsLoading(true);
          setAttempt((current) => current + 1);
        }}
      />
    );
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
    // The "Exit preview" lives in the learner's classroom (learn/), which only receives the address:
    // the capture around it decides before the Link. `contents`: the wrapper does not
    // enter the classroom's layout.
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

// Error and "no course": the usual sentence, with no featured title, and the way back is the
// builder of THIS course (before, the studio start).
function PreviewState({
  courseId,
  title,
  detail,
  onRetry,
}: {
  courseId: string;
  title: string;
  detail: string;
    /** Only on a read failure: reads the course again, without reloading the page. */
  onRetry?: () => void;
}) {
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
      <div className="mt-6 flex flex-wrap gap-3">
        {onRetry ? <Button onClick={onRetry}>{t("appErrors.retry")}</Button> : null}
        <Link
          href={href}
          onClick={(event) => leavePreview(event, href)}
          className="button-outline px-4 py-2.5 text-sm"
        >
          {t("creatorEditor.preview.back")}
        </Link>
      </div>
    </section>
  );
}
