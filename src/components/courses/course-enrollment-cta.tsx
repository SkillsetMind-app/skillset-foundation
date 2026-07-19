"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import type { Course } from "@/domain/learning";

type CourseEnrollmentCtaProps = {
  course: Course;
};

/**
 * Showcase CTA for the STATIC demo catalog — the homepage "featured" band and
 * the static /courses/[slug] sample pages (getCourseBySlug resolves only the
 * demo catalog; real teacher courses resolve through <CreatorCourseDetail>).
 *
 * These demo courses are marketing samples, NOT Firestore-backed records, so a
 * direct transaction against them always dead-ends:
 *   - startCourseCheckout(course.id) → the callable looks up
 *     db.collection("courses").doc(course.id), which doesn't exist for a demo
 *     id (e.g. "course-leadership-development"), and throws "Course not found".
 *   - createManualEnrollment(...) → a client write to /enrollments, denied by
 *     Firestore rules.
 *
 * So this CTA never transacts. It funnels the visitor into the LIVE marketplace
 * (/courses) where real, purchasable teacher courses are bought, and into
 * signup when logged out. The sample's own title anchors the copy so the page
 * reads as a genuine preview, not a broken store.
 */
export function CourseEnrollmentCta({ course }: CourseEnrollmentCtaProps) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <button
        type="button"
        disabled
        className="button-outline mt-6 w-full px-5 py-2.5 text-sm"
      >
        Loading...
      </button>
    );
  }

  if (status !== "authenticated") {
    return (
      <>
        <Link
          href="/auth?mode=signup"
          className="button-solid mt-6 w-full px-5 py-2.5 text-sm"
        >
          Create account to enroll
        </Link>
        <Link
          href="/auth?mode=signin"
          className="button-outline mt-3 w-full px-5 py-2.5 text-sm"
        >
          Sign in to continue
        </Link>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          &ldquo;{course.title}&rdquo; is a sample program. Browse the live
          marketplace to enroll in a course published by an independent expert.
        </p>
      </>
    );
  }

  return (
    <>
      <Link
        href="/courses"
        className="button-solid mt-6 w-full px-5 py-2.5 text-sm"
      >
        Browse live courses to enroll
      </Link>
      <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
        &ldquo;{course.title}&rdquo; is a sample program from the SkillsetMind
        catalog. Open the live marketplace to enroll in courses published by
        independent experts.
      </p>
    </>
  );
}
