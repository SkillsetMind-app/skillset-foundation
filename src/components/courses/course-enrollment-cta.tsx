"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { getCourseAccessDecision } from "@/domain/course-access";
import type { Enrollment } from "@/domain/enrollment";
import type { Course } from "@/domain/learning";
import {
  createManualEnrollment,
  subscribeToEnrollment,
} from "@/lib/data/enrollments";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";
import { startCourseCheckout } from "@/lib/payments/checkout";
import { hasPermission } from "@/lib/permissions";

type CourseEnrollmentCtaProps = {
  course: Course;
};

export function CourseEnrollmentCta({ course }: CourseEnrollmentCtaProps) {
  const { status, user } = useAuth();
  const [accessState, setAccessState] = useState<{
    key: string | null;
    enrollment: Enrollment | null;
    ready: boolean;
  }>({
    key: null,
    enrollment: null,
    ready: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const accessKey = user ? `${user.uid}::${course.slug}` : null;
  const accessDecision = getCourseAccessDecision(
    course,
    isPublicFeatureEnabled("payments.checkout"),
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToEnrollment(
      user.uid,
      course.slug,
      (nextEnrollment) => {
        setAccessState({
          key: `${user.uid}::${course.slug}`,
          enrollment: nextEnrollment,
          ready: true,
        });
      },
      () => {
        setError("We could not check your current access.");
        setAccessState({
          key: `${user.uid}::${course.slug}`,
          enrollment: null,
          ready: true,
        });
      },
    );
  }, [course.slug, user]);

  if (status === "loading" || (user && (!accessState.ready || accessState.key !== accessKey))) {
    return (
      <button type="button" disabled className="button-outline mt-6 w-full px-5 py-3 text-sm">
        Checking access...
      </button>
    );
  }

  if (!user) {
    return (
      <>
        <Link href="/auth?mode=signup" className="button-solid mt-6 w-full px-5 py-3 text-sm">
          Create account to enroll
        </Link>
        <Link href="/auth?mode=signin" className="button-outline mt-3 w-full px-5 py-3 text-sm">
          Sign in to continue
        </Link>
      </>
    );
  }

  if (!hasPermission({ roles: user.roles }, "courses.enroll")) {
    return (
      <>
        <Link href="/onboarding" className="button-solid mt-6 w-full px-5 py-3 text-sm">
          Update account access
        </Link>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          This account needs learner access before it can enroll in programs.
        </p>
      </>
    );
  }

  if (accessState.enrollment) {
    return (
      <>
        <Link
          href={`/learn/courses/${course.slug}`}
          className="button-solid mt-6 w-full px-5 py-3 text-sm"
        >
          Open in My Learning
        </Link>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          This course is already attached to your learner workspace.
        </p>
      </>
    );
  }

  if (accessDecision.mode === "not_open") {
    return (
      <>
        <button type="button" disabled className="button-outline mt-6 w-full px-5 py-3 text-sm">
          {accessDecision.title}
        </button>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          {accessDecision.detail}
        </p>
      </>
    );
  }

  if (accessDecision.mode === "paid_checkout_disabled") {
    return (
      <>
        <button type="button" disabled className="button-outline mt-6 w-full px-5 py-3 text-sm">
          {accessDecision.title}
        </button>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          {accessDecision.detail}
        </p>
      </>
    );
  }

  if (accessDecision.mode === "paid_checkout_required") {
    return (
      <>
        <button
          type="button"
          onClick={handleCheckout}
          disabled={isCheckingOut}
          className="button-solid mt-6 w-full px-5 py-3 text-sm disabled:opacity-60"
        >
          {isCheckingOut ? "Opening secure checkout..." : "Enroll with secure checkout"}
        </button>
        {checkoutError ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {checkoutError}
          </p>
        ) : (
          <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
            {accessDecision.detail}
          </p>
        )}
      </>
    );
  }

  // Hoisted so the paid_checkout_required branch above can call it. Mirrors
  // CreatorCourseDetail.handleCheckout: startCourseCheckout navigates away on
  // success (Stripe-hosted page), so we only clear the spinner in the failure
  // path. The server surfaces honest precondition errors (course not found,
  // teacher payouts not connected) which we show verbatim.
  async function handleCheckout() {
    if (!user) {
      return;
    }

    setCheckoutError("");
    setIsCheckingOut(true);

    try {
      await startCourseCheckout(course.id);
    } catch (checkoutFailure) {
      setCheckoutError(
        checkoutFailure instanceof Error && checkoutFailure.message
          ? checkoutFailure.message
          : "We could not start secure checkout. Try again or contact support.",
      );
      setIsCheckingOut(false);
    }
  }

  // The four access-mode guards above eliminate not_open and both paid modes,
  // so TypeScript narrows accessDecision to `free_enrollment` here: only a
  // genuinely free course can reach the manual-enroll action below.
  async function handleEnroll() {
    if (!user) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      await createManualEnrollment(user.uid, course);
    } catch {
      setError("We could not add this course to your learning workspace.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleEnroll}
        disabled={isSubmitting}
        className="button-solid mt-6 w-full px-5 py-3 text-sm disabled:opacity-60"
      >
        {isSubmitting ? "Adding course..." : "Add to My Learning"}
      </button>
      {error ? (
        <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          This connects the course to your learner workspace so you can keep your study path in one place.
        </p>
      )}
    </>
  );
}
