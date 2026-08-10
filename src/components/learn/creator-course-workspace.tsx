"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { canOpenEnrollment, type Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { teacherCourseToLearningCourse } from "@/lib/data/published-courses";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

export function CreatorCourseWorkspace({
  initialCourseId,
  whitelabel = false,
}: {
  initialCourseId?: string;
  /** Forwarded from the member-area shell: the course is opening under a
   *  teacher's own brand, so every link back into our platform stays hidden. */
  whitelabel?: boolean;
}) {
  const searchParams = useSearchParams();
  const courseId = initialCourseId ?? searchParams.get("courseId") ?? "";
  // Stripe's success_url lands here with ?checkout=success BEFORE the webhook
  // has created the enrollment row. During that gap the buyer must see a
  // "finalizing" state — not "Enrollment required" — and the workspace opens
  // as soon as a re-check finds the row the webhook committed.
  const cameFromCheckout = searchParams.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollmentRecheck, setEnrollmentRecheck] = useState(0);
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const { user } = useAuth();
  const [enrollmentState, setEnrollmentState] = useState<{
    enrollment: Enrollment | null;
    key: string | null;
    ready: boolean;
  }>({
    enrollment: null,
    key: null,
    ready: false,
  });
  const [courseState, setCourseState] = useState<{
    course: TeacherCourse | null;
    key: string | null;
    ready: boolean;
  }>({
    course: null,
    key: null,
    ready: false,
  });
  const [error, setError] = useState("");
  const enrollment =
    enrollmentState.key === courseId ? enrollmentState.enrollment : null;
  const canOpenCourse = enrollment ? canOpenEnrollment(enrollment.status) : false;
  const course = courseState.key === courseId ? courseState.course : null;
  const isLoadingEnrollment = Boolean(
    user
      && courseId
      && hasBackendConfig
      && (!enrollmentState.ready || enrollmentState.key !== courseId),
  );
  const isLoadingCourse = Boolean(
    canOpenCourse && (!courseState.ready || courseState.key !== courseId),
  );

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
    if (!cameFromCheckout || checkoutGraceExpired || enrollment) {
      return;
    }

    const interval = window.setInterval(
      () => setEnrollmentRecheck((tick) => tick + 1),
      5_000,
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
          key: courseId,
          ready: true,
        });
      },
      () => {
        setError("We could not confirm your enrollment for this creator course.");
        setEnrollmentState({
          enrollment: null,
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
          key: courseId,
          ready: true,
        });
      },
      () => {
        setError("We could not load this creator course workspace.");
        setCourseState({
          course: null,
          key: courseId,
          ready: true,
        });
      },
    );
  }, [courseId, enrollment]);

  if (!courseId) {
    return (
      <CreatorWorkspaceState
        title="Course not selected."
        detail="Open My Learning from an enrollment card or return to the marketplace."
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <CreatorWorkspaceState
        title="Creator course access is not connected."
        detail="Your enrolled courses cannot load right now. Refresh the page, or contact support if the problem continues."
      />
    );
  }

  if (isLoadingEnrollment || isLoadingCourse) {
    return (
      <CreatorWorkspaceState
        title="Loading course workspace..."
        detail="We are confirming enrollment and loading the teacher-published course."
      />
    );
  }

  if (error) {
    return <CreatorWorkspaceState title="Course unavailable." detail={error} />;
  }

  if (!enrollment) {
    if (cameFromCheckout) {
      return checkoutGraceExpired ? (
        <CreatorWorkspaceState
          title="Almost there — enrollment is taking longer than usual."
          detail="Your payment went through and is safe. Keep this page open: it opens automatically the moment your enrollment is confirmed. If nothing happens in a few minutes, contact support with your payment receipt."
        />
      ) : (
        <CreatorWorkspaceState
          title="Payment received — opening your course..."
          detail="Your payment is confirmed. We are setting up your course access right now; this page opens automatically in a few seconds."
        />
      );
    }

    return (
      <CreatorWorkspaceState
        title="Enrollment required."
        detail="This private workspace opens only after payment, admin enrollment, or approved access."
      />
    );
  }

  if (!canOpenCourse) {
    return (
      <CreatorWorkspaceState
        title="Course access is inactive."
        detail={`This enrollment is ${enrollment.status}. Private lessons reopen only after payment, admin approval, or restored access.`}
      />
    );
  }

  if (!course) {
    return (
      <CreatorWorkspaceState
        title="Course record not found."
        detail="The enrollment exists, but the course record is unavailable or restricted."
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
      <EnrolledCourseWorkspace
        course={teacherCourseToLearningCourse(course)}
        enableFirestoreAssets
        whitelabel={whitelabel}
      />
    </>
  );
}

function CreatorWorkspaceState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Creator course access
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/learn" className="button-solid px-4 py-2.5 text-sm">
          Back to My Learning
        </Link>
        <Link href="/courses" className="button-outline px-4 py-2.5 text-sm">
          Open marketplace
        </Link>
      </div>
    </section>
  );
}
