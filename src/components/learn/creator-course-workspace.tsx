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
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getFirebaseClientConfig } from "@/lib/firebase/config";

export function CreatorCourseWorkspace({
  initialCourseId,
}: {
  initialCourseId?: string;
}) {
  const searchParams = useSearchParams();
  const courseId = initialCourseId ?? searchParams.get("courseId") ?? "";
  // Stripe's success_url lands here with ?checkout=success BEFORE the webhook
  // has created the enrollment doc. During that gap the buyer must see a
  // "finalizing" state — not "Enrollment required" — and the realtime
  // enrollment listener opens the workspace the moment the webhook commits.
  const cameFromCheckout = searchParams.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const hasFirebaseConfig = Boolean(getFirebaseClientConfig());
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
      && hasFirebaseConfig
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

  useEffect(() => {
    if (!user || !courseId || !hasFirebaseConfig) {
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
  }, [courseId, hasFirebaseConfig, user]);

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

  if (!hasFirebaseConfig) {
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
    <EnrolledCourseWorkspace
      course={teacherCourseToLearningCourse(course)}
      enableFirestoreAssets
    />
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
