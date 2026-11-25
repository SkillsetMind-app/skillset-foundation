"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import { canOpenEnrollment, type Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { teacherCourseToLearningCourse } from "@/lib/data/published-courses";
import { CourseViewedTracker, PurchaseCompletedTracker } from "@/lib/posthog/page-trackers";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

export function CreatorCourseWorkspace({
  initialCourseId,
  whitelabel = false,
  tab = "lesson",
  openPostId = null,
}: {
  initialCourseId?: string;
  /** Forwarded from the member-area shell: the course is opening under a
   *  teacher's own brand, so every link back into our platform stays hidden. */
  whitelabel?: boolean;
  /** The tab of the classroom opened by the route (lesson | materials | community...). */
  tab?: ClassroomTab;
  /** A community post opened in the drawer. */
  openPostId?: string | null;
}) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const courseId = initialCourseId ?? searchParams.get("courseId") ?? "";
  // Stripe's success_url lands here with ?checkout=success BEFORE the webhook
  // has created the enrollment row. During that gap the buyer must see a
  // "finalizing" state — not "Enrollment required" — and the workspace opens
  // as soon as a re-check finds the row the webhook committed.
  const cameFromCheckout = searchParams.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollmentRecheck, setEnrollmentRecheck] = useState(0);
  // "Try again" for the course read: the same dependency counter as
  // enrollmentRecheck, for the course subscription (read only, nothing is written).
  const [courseRecheck, setCourseRecheck] = useState(0);
  // After a "Try again" that worked, the classroom gets focus on the title:
  // the button disappears with the wait state and focus used to fall on <body>.
  const [focusClassroom, setFocusClassroom] = useState(false);
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const { user, signOut } = useAuth();
  const [enrollmentState, setEnrollmentState] = useState<{
    enrollment: Enrollment | null;
    error: string;
    key: string | null;
    ready: boolean;
  }>({
    enrollment: null,
    error: "",
    key: null,
    ready: false,
  });
  const [courseState, setCourseState] = useState<{
    course: TeacherCourse | null;
    error: string;
    key: string | null;
    ready: boolean;
  }>({
    course: null,
    error: "",
    key: null,
    ready: false,
  });
  const enrollment =
    enrollmentState.key === courseId ? enrollmentState.enrollment : null;
  const canOpenCourse = enrollment ? canOpenEnrollment(enrollment.status) : false;
  const course = courseState.key === courseId ? courseState.course : null;
  const error =
    (enrollmentState.key === courseId ? enrollmentState.error : "") ||
    (canOpenCourse && courseState.key === courseId ? courseState.error : "");
  const isLoadingEnrollment = Boolean(
    user
      && courseId
      && hasBackendConfig
      && (!enrollmentState.ready || enrollmentState.key !== courseId),
  );
  const isLoadingCourse = Boolean(
    canOpenCourse && (!courseState.ready || courseState.key !== courseId),
  );
  // The "Try again" focus request is good for ONE opening: the classroom reads it
  // on mount. When it closes (wait, error, no access), the request ends; a
  // reopening without "Try again" does not pull focus to the title again. Adjusted
  // during render, with the previous value stored (no setState in an effect).
  const classroomOpen = canOpenCourse && course !== null;
  const [classroomWasOpen, setClassroomWasOpen] = useState(false);
  if (classroomOpen !== classroomWasOpen) {
    setClassroomWasOpen(classroomOpen);
    if (!classroomOpen) setFocusClassroom(false);
  }
  const router = useRouter();
  // Once the paid enrollment has opened the course, the checkout marker has
  // done its job. Left in the URL it rode along into lesson links, bookmarks
  // and new tabs, and every reopen looked like a fresh purchase. One replace,
  // keeping every other param (the lesson, for one).
  const checkoutCourseOpened = cameFromCheckout && canOpenCourse && Boolean(course);
  useEffect(() => {
    if (!checkoutCourseOpened) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("checkout");
    const query = params.toString();
    const path = window.location.pathname;
    router.replace(query ? `${path}?${query}` : path, { scroll: false });
  }, [checkoutCourseOpened, router, searchParams]);

  useEffect(() => {
    if (!cameFromCheckout) {
      return;
    }

    // Webhook fulfilment normally lands in seconds; after 90s without an
    // enrollment something is genuinely stuck and the copy should say so
    // instead of spinning forever.
    const timer = window.setTimeout(() => setCheckoutGraceExpired(true), 90_000);

    return () => window.clearTimeout(timer);
  }, [cameFromCheckout]);

  // Belt and braces for the checkout gap. public.enrollments IS in the
  // supabase_realtime publication, so subscribeToEnrollment normally delivers
  // the webhook's row over postgres_changes — but that path is a WebSocket,
  // and a dropped socket, a blocking proxy or a backgrounded mobile tab all
  // fail silently: the channel stays subscribed and simply never fires. The
  // buyer has already paid, so "silently stuck until the 90s grace expires" is
  // the one outcome worth paying a poll to avoid. Bumping this counter re-runs
  // the subscription effect below, which re-issues its one-shot read. The deps
  // double as the stop conditions: React clears the interval the moment the
  // enrollment arrives, the grace window closes, or the component unmounts.
  useEffect(() => {
    if (!cameFromCheckout || enrollment) {
      return;
    }

    // The poll does NOT stop at 90s. It used to stop — `checkoutGraceExpired` was
    // an exit condition here — and that turned off the fallback exactly at the
    // moment it becomes the only thing that can work: going past 90s is precisely
    // the sign that the WebSocket did not deliver. After the grace period the
    // screen promises "it opens automatically the moment your
    // enrollment is confirmed", and the dead socket was the only remaining way
    // to keep that promise. Someone who had already paid stayed stuck until they reloaded by hand.
    //
    // The grace period now only changes the PACE: 5s while it is fast, 20s after — a
    // late webhook (Stripe retry, full queue) still lands.
    const interval = window.setInterval(
      () => setEnrollmentRecheck((tick) => tick + 1),
      checkoutGraceExpired ? 20_000 : 5_000,
    );

    return () => window.clearInterval(interval);
  }, [cameFromCheckout, checkoutGraceExpired, enrollment]);

  useEffect(() => {
    if (!user || !courseId || !hasBackendConfig) {
      return;
    }

    return subscribeToEnrollment(
      user.uid,
      courseId,
      (nextEnrollment) => {
        setEnrollmentState({
          enrollment: nextEnrollment,
          error: "",
          key: courseId,
          ready: true,
        });
      },
      () => {
        setEnrollmentState({
          enrollment: null,
          error: "learnWave2.workspace.enrollmentError",
          key: courseId,
          ready: true,
        });
      },
    );
  }, [courseId, enrollmentRecheck, hasBackendConfig, user]);

  useEffect(() => {
    if (!enrollment || !canOpenEnrollment(enrollment.status) || !courseId) {
      return;
    }

    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setCourseState({
          course: nextCourse,
          error: "",
          key: courseId,
          ready: true,
        });
      },
      () => {
        setCourseState({
          course: null,
          error: "learnWave2.workspace.courseError",
          key: courseId,
          ready: true,
        });
      },
    );
  }, [courseId, courseRecheck, enrollment]);

  if (!courseId) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.notSelected")}
        detail={t("learnWave2.workspace.notSelectedDetail")}
        whitelabel={whitelabel}
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.disconnected")}
        detail={t("learnWave2.workspace.disconnectedDetail")}
        whitelabel={whitelabel}
      />
    );
  }

  if (isLoadingEnrollment || isLoadingCourse) {
    // Same shape as the workspace wait state right after: lesson in the address =
    // short header (enrolled-course-workspace.tsx, isCourseHome).
    return (
      <ClassroomLoading
        label={t("learnWave2.courseLoading.title")}
        short={Boolean(searchParams.get("lesson")) && tab !== "about"}
      />
    );
  }

  if (error) {
    // Only a read FAILURE gets "Try again" (no access, no enrollment and a
    // nonexistent course stay as they are). It clears the read that failed (the
    // classroom wait state comes back on screen) and redoes the same read once.
    const retryRead = () => {
      setFocusClassroom(true);
      if (enrollmentState.key === courseId && enrollmentState.error) {
        setEnrollmentState({ enrollment: null, error: "", key: null, ready: false });
        setEnrollmentRecheck((tick) => tick + 1);
        return;
      }
      setCourseState({ course: null, error: "", key: null, ready: false });
      setCourseRecheck((tick) => tick + 1);
    };
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.unavailable")}
        detail={t(error)}
        whitelabel={whitelabel}
        onRetry={retryRead}
      />
    );
  }

  // Without access, the way out is the course's public page (and signing out, if it is the wrong account).
  const coursePage = {
    href: `/courses/${encodeURIComponent(courseId)}`,
    label: t("learnWave2.workspace.seeCourse"),
  };
  // Signed out, this same page asks to sign in and comes back here.
  const onSignOut = () => void signOut();

  if (!enrollment) {
    if (cameFromCheckout) {
      return checkoutGraceExpired ? (
        <CreatorWorkspaceState
          title={t("learnWave2.workspace.delayed")}
          detail={t("learnWave2.workspace.delayedDetail")}
          whitelabel={whitelabel}
        />
      ) : (
        <CreatorWorkspaceState
          title={t("learnWave2.workspace.received")}
          detail={t("learnWave2.workspace.receivedDetail")}
          whitelabel={whitelabel}
        />
      );
    }

    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.required")}
        detail={t("learnWave2.workspace.requiredDetail")}
        whitelabel={whitelabel}
        coursePage={coursePage}
        onSignOut={onSignOut}
      />
    );
  }

  if (!canOpenCourse) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.inactive")}
        detail={t("learnWave2.workspace.inactiveDetail").replace("{status}", () => t(`learnWave2.enrollmentStatus.${enrollment.status}`))}
        whitelabel={whitelabel}
        coursePage={coursePage}
        onSignOut={onSignOut}
      />
    );
  }

  if (!course) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.missing")}
        detail={t("learnWave2.workspace.missingDetail")}
        whitelabel={whitelabel}
      />
    );
  }

  return (
    <>
      {/* COURSE_VIEWED for teacher-published courses. It fires here rather
          than in the route because the URL segment is ambiguous — sometimes a
          DB id, sometimes an enrollment slug — and mixing both into course_id
          would break every aggregation. `course.id` is the only reliable key.
          slug is omitted: TeacherCourse has no slug field (the converter just
          aliases slug: course.id), and CourseViewedProps makes it optional. */}
      <CourseViewedTracker course_id={course.id} source="direct" />
      {/* PURCHASE_COMPLETED: Stripe's success_url lands here, and reaching this
          branch means the webhook's enrollment exists and opened the course.
          The tracker keeps it to one event per course per session. */}
      {cameFromCheckout ? <PurchaseCompletedTracker course_id={course.id} /> : null}
      <EnrolledCourseWorkspace
        course={teacherCourseToLearningCourse(course)}
        enableFirestoreAssets
        whitelabel={whitelabel}
        tab={tab}
        openPostId={openPostId}
        // Already subscribed above: the classroom used to fetch the same row
        // again, behind its own loading screen.
        enrollment={enrollment}
        focusTitleOnOpen={focusClassroom}
      />
    </>
  );
}

function CreatorWorkspaceState({
  title,
  detail,
  whitelabel = false,
  coursePage,
  onSignOut,
  onRetry,
}: {
  title: string;
  detail: string;
  /** Under a teacher's own brand nothing links back to our marketplace. */
  whitelabel?: boolean;
  /** The course's own public page: the main way out when there is no access. */
  coursePage?: { href: string; label: string };
  onSignOut?: () => void;
  /** READ failure: the detail becomes the house notice with "Try again". */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  return (
    <section ref={sectionRef} tabIndex={-1} className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("learnWave2.workspace.eyebrow")}
      </p>
      {/* h1: in these states this section IS the whole page. The happy path
          hands off to EnrolledCourseWorkspace, which brings the MembersAreaHero with the
          h1 — but while loading, on error, with no enrollment and, most important,
          on the "payment received" screen, none of that renders. The buyer
          who had just paid was left in a document whose only heading was a
          loose h3, with no page title at all. */}
      <h1 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h1>
      {onRetry ? (
        <LoadErrorAlert focusRef={sectionRef} onRetry={onRetry} className="mt-4 max-w-2xl">
          {detail}
        </LoadErrorAlert>
      ) : (
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {detail}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {coursePage ? (
          <Link href={coursePage.href} className="button-solid px-4 py-2.5 text-sm">
            {coursePage.label}
          </Link>
        ) : null}
        <Link href="/learn" className={`${coursePage ? "button-outline" : "button-solid"} px-4 py-2.5 text-sm`}>
          {t("learnWave2.workspace.back")}
        </Link>
        {whitelabel ? null : (
          <Link href="/courses" className="button-outline px-4 py-2.5 text-sm">
            {t("learnWave2.workspace.marketplace")}
          </Link>
        )}
      </div>
      {onSignOut ? (
        <button
          type="button"
          onClick={onSignOut}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
        >
          {t("learnWave2.workspace.wrongAccount")}
        </button>
      ) : null}
    </section>
  );
}
