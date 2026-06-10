"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { CourseCommunityFeed } from "@/components/learn/course-community-feed";
import type { Enrollment } from "@/domain/enrollment";
import type { CommunitySpace } from "@/domain/learning";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getFirebaseClientConfig } from "@/lib/firebase/config";

export function CreatorCourseCommunity() {
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId") ?? "";
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
  const course = courseState.key === courseId ? courseState.course : null;
  const isLoadingEnrollment = Boolean(
    user
      && courseId
      && hasFirebaseConfig
      && (!enrollmentState.ready || enrollmentState.key !== courseId),
  );
  const isLoadingCourse = Boolean(
    enrollment && (!courseState.ready || courseState.key !== courseId),
  );

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
        setError("We could not confirm your community access for this creator course.");
        setEnrollmentState({
          enrollment: null,
          key: courseId,
          ready: true,
        });
      },
    );
  }, [courseId, hasFirebaseConfig, user]);

  useEffect(() => {
    if (!enrollment || !courseId) {
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
        setError("We could not load this creator course community.");
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
      <CreatorCommunityState
        title="Course not selected."
        detail="Open a creator course community from your enrolled community list."
      />
    );
  }

  if (!hasFirebaseConfig) {
    return (
      <CreatorCommunityState
        title="Creator community access is not connected."
        detail="Community spaces cannot load right now. Refresh the page, or contact support if the problem continues."
      />
    );
  }

  if (isLoadingEnrollment || isLoadingCourse) {
    return (
      <CreatorCommunityState
        title="Loading community..."
        detail="We are confirming enrollment and preparing this course discussion space."
      />
    );
  }

  if (error) {
    return <CreatorCommunityState title="Community unavailable." detail={error} />;
  }

  if (!enrollment) {
    return (
      <CreatorCommunityState
        title="Enrollment required."
        detail="This community opens only for learners enrolled in the creator course."
      />
    );
  }

  if (!course) {
    return (
      <CreatorCommunityState
        title="Course record not found."
        detail="The enrollment exists, but the course record is unavailable or restricted."
      />
    );
  }

  const space: CommunitySpace = {
    id: `creator-${course.id}`,
    courseSlug: course.id,
    name: `${course.title} community`,
    description: "A course-linked space for announcements, questions, resources, and cohort discussion.",
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  };

  // The course owner moderates their own space (pin/unpin). The pinned *render*
  // is on for everyone; only this control is owner-gated, and the security rule
  // is the real authority (ownsCourse) — this just avoids a dead affordance.
  const canModerate = Boolean(user && course.ownerId === user.uid);

  return <CourseCommunityFeed space={space} canModerate={canModerate} />;
}

function CreatorCommunityState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
        Creator course community
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/learn/community" className="button-solid px-5 py-3 text-sm">
          Back to communities
        </Link>
        <Link href="/learn" className="button-outline px-5 py-3 text-sm">
          Back to My Learning
        </Link>
      </div>
    </section>
  );
}
