"use client";

import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import type {
  CreateTeacherCourseInput,
  TeacherCourse,
  TeacherCourseStatus,
  UpdateTeacherCourseBuilderInput,
} from "@/domain/teacher-course";
import { normalizeCourseCategories } from "@/domain/teacher-course";
import { getFirebaseFunctions, getFirestoreDb } from "@/lib/firebase/client";

const coursesCollection = "courses";

export async function createTeacherCourse(input: CreateTeacherCourseInput) {
  const paymentType = input.paymentType ?? "one_time";
  const createDraft = httpsCallable<
    {
      title: string;
      summary: string;
      category: string;
      categories: string[];
      paymentType: NonNullable<CreateTeacherCourseInput["paymentType"]>;
    },
    { courseId: string }
  >(getFirebaseFunctions(), "createTeacherCourseDraft");

  const categories = normalizeCourseCategories([
    ...(input.categories ?? []),
    input.category,
  ]);
  const result = await createDraft({
    title: input.title,
    summary: input.summary,
    category: categories[0] ?? input.category,
    categories,
    paymentType,
  });

  return result.data.courseId;
}

export async function submitTeacherCourseForReview(courseId: string) {
  const submitForReview = httpsCallable<
    { courseId: string },
    { success: true }
  >(getFirebaseFunctions(), "submitTeacherCourseForReview");

  await submitForReview({ courseId });
}

export async function deleteTeacherCourse(courseId: string) {
  const deleteDraft = httpsCallable<
    { courseId: string },
    { success: true }
  >(getFirebaseFunctions(), "deleteTeacherCourseDraft");

  await deleteDraft({ courseId });
}

export async function deleteCourseAsAdmin(courseId: string) {
  const deleteCourse = httpsCallable<
    { courseId: string },
    { success: true }
  >(getFirebaseFunctions(), "deleteCourseAsAdmin");

  await deleteCourse({ courseId });
}

export async function updateCourseReviewStatus(
  courseId: string,
  status: Extract<TeacherCourseStatus, "published" | "needs_changes" | "inactive">,
  reviewNote: string | null = null,
) {
  await updateDoc(doc(getFirestoreDb(), coursesCollection, courseId), {
    status,
    reviewNote: reviewNote?.trim() || null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Editorial curation toggle, ops/admin only. Pins a course to the top of the
 * public marketplace ("Featured & top picks" sort) and orders featured courses
 * among themselves by `featuredRank` (lower = higher placement). Writes exactly
 * `featured` + `featuredRank` + `updatedAt` so it matches the field-scoped
 * `opsCanUpdateCourseFeatured()` Firestore rule — a teacher saving their own
 * course cannot touch these fields. Passing `featured = false` clears the rank
 * too, so an unfeatured course never carries a stale placement.
 */
export async function setCourseFeatured(
  courseId: string,
  featured: boolean,
  featuredRank: number | null = null,
) {
  await updateDoc(doc(getFirestoreDb(), coursesCollection, courseId), {
    featured,
    featuredRank: featured
      ? typeof featuredRank === "number" && Number.isFinite(featuredRank)
        ? Math.max(0, Math.round(featuredRank))
        : null
      : null,
    updatedAt: serverTimestamp(),
  });
}

export async function updateTeacherCourseBuilder(
  courseId: string,
  input: UpdateTeacherCourseBuilderInput,
) {
  const saveBuilder = httpsCallable<
    UpdateTeacherCourseBuilderInput & { courseId: string },
    { success: true }
  >(getFirebaseFunctions(), "updateTeacherCourseBuilder");

  await saveBuilder({
    ...input,
    courseId,
    title: input.title.trim(),
    summary: input.summary.trim(),
    category: input.category.trim(),
    categories: normalizeCourseCategories([
      ...(input.categories ?? []),
      input.category,
    ]),
  });
}

export function subscribeToTeacherCourse(
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

export function subscribeToTeacherCourses(
  ownerId: string,
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const coursesQuery = query(
    collection(getFirestoreDb(), coursesCollection),
    where("ownerId", "==", ownerId),
  );

  return onSnapshot(
    coursesQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<TeacherCourse, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeToCoursesInReview(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const reviewQuery = query(
    collection(getFirestoreDb(), coursesCollection),
    where("status", "==", "in_review"),
  );

  return onSnapshot(
    reviewQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<TeacherCourse, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeToManagedCourses(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const managedQuery = query(
    collection(getFirestoreDb(), coursesCollection),
    where("status", "in", ["published", "inactive"]),
  );

  return onSnapshot(
    managedQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...(document.data() as Omit<TeacherCourse, "id">),
        })),
      );
    },
    onError,
  );
}
