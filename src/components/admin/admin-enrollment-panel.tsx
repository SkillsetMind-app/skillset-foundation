"use client";

import { useEffect, useMemo, useState } from "react";

import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToAdminUserProfiles } from "@/lib/data/admin-users";
import {
  createAdminEnrollmentForTeacherCourse,
  revokeEnrollment,
  subscribeToAdminGrantedEnrollments,
} from "@/lib/data/enrollments";
import { subscribeToPublishedTeacherCourses } from "@/lib/data/published-courses";

export function AdminEnrollmentPanel() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [userId, setUserId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [grantedEnrollments, setGrantedEnrollments] = useState<Enrollment[]>([]);
  const [isLoadingGranted, setIsLoadingGranted] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToAdminUserProfiles(
      (nextUsers) => {
        setUsers(nextUsers);
        setIsLoadingUsers(false);
      },
      () => {
        setError("We could not load users for manual enrollment.");
        setIsLoadingUsers(false);
      },
    );
  }, []);

  useEffect(() => {
    return subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoadingCourses(false);
      },
      () => {
        setError("We could not load published creator courses.");
        setIsLoadingCourses(false);
      },
    );
  }, []);

  useEffect(() => {
    return subscribeToAdminGrantedEnrollments(
      (nextEnrollments) => {
        setGrantedEnrollments(nextEnrollments);
        setIsLoadingGranted(false);
      },
      () => {
        setError("We could not load granted enrollments.");
        setIsLoadingGranted(false);
      },
    );
  }, []);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === courseId) ?? null,
    [courseId, courses],
  );

  async function handleCreateEnrollment() {
    if (!userId || !selectedCourse) {
      setError("Choose a user and a published creator course.");
      return;
    }

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      await createAdminEnrollmentForTeacherCourse(userId, selectedCourse);
      setSuccess("Admin enrollment created. The learner can now open the creator course workspace.");
    } catch {
      setError("We could not create this enrollment. Check admin role and rules.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRevoke(enrollment: Enrollment) {
    const confirmed = window.confirm(
      `Revoke access to "${enrollment.courseTitle}" for this learner? They lose access immediately.`,
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
    setRevokingId(enrollment.id);

    try {
      await revokeEnrollment(enrollment.id);
      setSuccess("Enrollment revoked.");
    } catch {
      setError("We could not revoke this enrollment. Check admin role and rules.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
            Manual enrollment
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            Grant beta access without fake checkout.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Use this only for beta, support, or admin-granted access. Paid
            enrollment still belongs to Stripe webhook activation.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          Admin only
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Learner
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={isLoadingUsers || users.length === 0}
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          >
            <option value="">
              {isLoadingUsers ? "Loading users..." : "Choose user"}
            </option>
            {users.map((user) => (
              <option key={user.uid} value={user.uid}>
                {user.displayName || user.email || user.uid}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Published creator course
          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            disabled={isLoadingCourses || courses.length === 0}
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          >
            <option value="">
              {isLoadingCourses ? "Loading courses..." : "Choose course"}
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(26,54,93,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          {success}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleCreateEnrollment}
        disabled={isSaving || !userId || !selectedCourse}
        className="button-solid mt-6 px-5 py-3 text-sm disabled:opacity-60"
      >
        {isSaving ? "Creating enrollment..." : "Create admin enrollment"}
      </button>

      <div className="mt-8 border-t border-[var(--color-line)] pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-brand)]">
            Granted enrollments
          </h4>
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            {grantedEnrollments.length} active
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          Admin and demo grants only. Revoking removes the learner&apos;s access
          immediately.
        </p>

        <div className="mt-4 grid gap-3">
          {isLoadingGranted ? (
            <p className="text-sm text-[var(--color-ink-soft)]">
              Loading granted enrollments...
            </p>
          ) : grantedEnrollments.length === 0 ? (
            <p className="rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
              No admin or demo grants yet.
            </p>
          ) : (
            grantedEnrollments.map((enrollment) => {
              const learner = users.find((user) => user.uid === enrollment.userId);

              return (
                <article
                  key={enrollment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">
                      {enrollment.courseTitle}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                      {learner?.displayName || learner?.email || enrollment.userId}
                      {" - "}
                      {enrollment.source === "admin" ? "Admin grant" : "Demo access"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(enrollment)}
                    disabled={revokingId === enrollment.id}
                    className="button-outline px-4 py-2 text-xs disabled:opacity-60"
                  >
                    {revokingId === enrollment.id ? "Revoking..." : "Revoke access"}
                  </button>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
