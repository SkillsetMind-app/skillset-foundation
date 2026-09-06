"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

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
 * These demo courses are marketing samples with no row in the `courses` table,
 * and this component never transacts against them: it renders only <Link>s —
 * no checkout call, no enrollment write, no mutation of any kind. That is the
 * guarantee, and it holds by construction rather than by any server-side gate.
 *
 * The gate exists anyway as defence in depth: were a demo id ever posted to
 * /api/payments/checkout, the route's course lookup misses and it answers
 * PaymentError("Course not found", 404) — see app/api/payments/checkout.
 *
 * So the CTA funnels the visitor into the LIVE marketplace (/courses) where
 * real, purchasable teacher courses are bought, and into signup when logged
 * out. The sample's own title anchors the copy so the page reads as a genuine
 * preview, not a broken store.
 */
export function CourseEnrollmentCta({ course }: CourseEnrollmentCtaProps) {
  const { t } = useTranslation();
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <button
        type="button"
        disabled
        className="button-outline mt-6 w-full px-5 py-2.5 text-sm"
      >{t("publicCourses.loading")}</button>
    );
  }

  if (status !== "authenticated") {
    return (
      <>
        <Link
          href="/auth?mode=signup"
          className="button-solid mt-6 w-full px-5 py-2.5 text-sm"
        >{t("publicCourses.createAccount")}</Link>
        <Link
          href="/auth?mode=signin"
          className="button-outline mt-3 w-full px-5 py-2.5 text-sm"
        >{t("publicCourses.signInContinue")}</Link>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          {t("publicCourses.sampleGuest").replace("{title}", course.title)}
        </p>
      </>
    );
  }

  return (
    <>
      <Link
        href="/courses"
        className="button-solid mt-6 w-full px-5 py-2.5 text-sm"
      >{t("publicCourses.browseLive")}</Link>
      <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
        {t("publicCourses.sampleMember").replace("{title}", course.title)}
      </p>
    </>
  );
}
