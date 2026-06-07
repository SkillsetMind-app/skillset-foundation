"use client";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import type { TeacherCourse } from "@/domain/teacher-course";
import { normalizeLearningOutcomes } from "@/domain/teacher-course";
import type { Course } from "@/domain/learning";
import type { CourseCard } from "@/lib/data/catalog";
import { getFirestoreDb } from "@/lib/firebase/client";

const coursesCollection = "courses";

export function subscribeToPublishedTeacherCourses(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  // Sell-on-submit: a course that left draft (status `in_review`) must be
  // immediately listed AND purchasable — selling is NOT gated by approval.
  // Review is non-blocking; a reviewer only *removes* a course from sale by
  // flipping it out of these two states. draft / needs_changes / inactive
  // stay hidden from the public marketplace.
  const coursesQuery = query(
    collection(getFirestoreDb(), coursesCollection),
    where("status", "in", ["published", "in_review"]),
  );

  return onSnapshot(
    coursesQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<TeacherCourse, "id">),
          }))
          .sort((left, right) => left.title.localeCompare(right.title)),
      );
    },
    onError,
  );
}

/**
 * Subscribe to a single course doc for the public course-detail surface.
 * Unlike the catalog list, this does NOT filter by published status: Firestore
 * rules already gate reads to the public (published courses) plus the course
 * owner and admins. Returning the raw doc lets the detail view tell an
 * owner/admin that their not-yet-public course is awaiting approval instead of
 * showing a generic dead-end. A non-authorized reader of an unpublished course
 * is rejected by the rules and surfaces through `onError`.
 */
export function subscribeToViewableTeacherCourse(
  courseId: string,
  callback: (course: TeacherCourse | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), coursesCollection, courseId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({
        id: snapshot.id,
        ...(snapshot.data() as Omit<TeacherCourse, "id">),
      });
    },
    onError,
  );
}

export function teacherCourseToCourseCard(course: TeacherCourse): CourseCard {
  const priceLabel =
    typeof course.priceAmountMinor === "number"
      ? new Intl.NumberFormat("en", {
          style: "currency",
          currency: course.currency ?? "USD",
        }).format(course.priceAmountMinor / 100)
      : "Enrollment opening soon";
  const hasFreePreview = Boolean(course.freePreviewLessonId);
  const ratingLabel =
    course.ratingCount && course.ratingAverage
      ? `${course.ratingAverage.toFixed(1)} rating (${course.ratingCount})`
      : "New course";

  return {
    slug: course.id,
    title: course.title,
    category: course.category,
    duration: `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`,
    status: "Creator course",
    summary: course.summary,
    image: course.coverImageUrl
      || "/brand/logo-mark.png",
    detail: "Created by an approved Skillset educator.",
    priceLabel,
    freePreviewLabel: hasFreePreview
      ? "Free preview selected"
      : "Preview coming soon",
    hasPaidAccess: false,
    href: `/courses/${course.id}`,
    freePreviewHref: hasFreePreview
      ? `/courses/${course.id}#free-preview`
      : undefined,
    sourceLabel: "Teacher published",
    ratingLabel,
    // Raw signals for marketplace sorting (price / rating). Display strings
    // above stay the source of truth for rendering; these feed comparators only.
    priceAmountMinor: course.priceAmountMinor ?? null,
    ratingAverage: course.ratingAverage,
    ratingCount: course.ratingCount,
  };
}

export function teacherCourseToLearningCourse(course: TeacherCourse): Course {
  const priceLabel =
    typeof course.priceAmountMinor === "number"
      ? new Intl.NumberFormat("en", {
          style: "currency",
          currency: course.currency ?? "USD",
        }).format(course.priceAmountMinor / 100)
      : "Enrollment opening soon";
  const hasFreePreview = Boolean(course.freePreviewLessonId);
  const teacherOutcomes = normalizeLearningOutcomes(course.learningOutcomes);

  return {
    id: course.id,
    slug: course.id,
    title: course.title,
    category: course.category,
    durationLabel: `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`,
    status: "published",
    statusLabel: "Published",
    summary: course.summary,
    detail: "This private workspace is connected to a teacher-published Skillset course.",
    image: course.coverImageUrl
      || "/brand/logo-mark.png",
    level: "Professional",
    priceLabel,
    priceAmountMinor: course.priceAmountMinor ?? null,
    currency: course.currency ?? "USD",
    platformFeeBps: course.platformFeeBps ?? 800,
    dripStrategy: course.dripStrategy ?? "instant",
    dripIntervalDays: course.dripIntervalDays ?? 1,
    freePreviewLabel: hasFreePreview
      ? "Free preview selected"
      : "Preview coming soon",
    outcomes:
      teacherOutcomes.length > 0
        ? teacherOutcomes
        : [
            "Complete the teacher-defined lesson path.",
            "Use course events and community spaces to support progress.",
            "Track completion toward Skillset credential eligibility.",
          ],
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      summary:
        module.summary
        || `${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}`,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        duration: lesson.durationMinutes
          ? `${lesson.durationMinutes} min`
          : "Self-paced",
        isPreview: lesson.id === course.freePreviewLessonId,
        description: lesson.description,
        contentText: lesson.contentText ?? null,
        externalUrl: lesson.externalUrl ?? null,
        dripDelayDays: lesson.dripDelayDays ?? null,
      })),
    })),
    communityEnabled: true,
  };
}
