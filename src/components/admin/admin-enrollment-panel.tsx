"use client";

import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Field, InlineAlert } from "@/components/ui";
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
  const { t } = useTranslation();
  const copy = "platform.ops.enrollmentPanel";
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [userId, setUserId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [readErrors, setReadErrors] = useState({ users: false, courses: false, grants: false });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [grantedEnrollments, setGrantedEnrollments] = useState<Enrollment[]>([]);
  const [isLoadingGranted, setIsLoadingGranted] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToAdminUserProfiles(
      (nextUsers) => {
        setUsers(nextUsers);
        setReadErrors(current => ({ ...current, users: false }));
        setIsLoadingUsers(false);
      },
      () => {
        setReadErrors(current => ({ ...current, users: true }));
        setIsLoadingUsers(false);
      },
    );
  }, []);

  useEffect(() => {
    return subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setCourses(nextCourses);
        setReadErrors(current => ({ ...current, courses: false }));
        setIsLoadingCourses(false);
      },
      () => {
        setReadErrors(current => ({ ...current, courses: true }));
        setIsLoadingCourses(false);
      },
    );
  }, []);

  useEffect(() => {
    return subscribeToAdminGrantedEnrollments(
      (nextEnrollments) => {
        setGrantedEnrollments(nextEnrollments);
        setReadErrors(current => ({ ...current, grants: false }));
        setIsLoadingGranted(false);
      },
      () => {
        setReadErrors(current => ({ ...current, grants: true }));
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
      setError("choose");
      return;
    }

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      await createAdminEnrollmentForTeacherCourse(userId, selectedCourse);
      setSuccess("created");
    } catch {
      setError("create");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRevoke(enrollment: Enrollment) {
    const confirmed = window.confirm(
      t(`${copy}.confirmRevoke`).replace("{title}", () => enrollment.courseTitle),
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
    setRevokingId(enrollment.id);

    try {
      await revokeEnrollment(enrollment.id);
      setSuccess("revoked");
    } catch {
      setError("revoke");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t(`${copy}.eyebrow`)}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {t("platform.ops.paymentsPanel.adminOnly")}
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field id="ops-enrollment-user" label={t(`${copy}.learner`)} error={readErrors.users ? t(`${copy}.readErrors.users`) : undefined}>
          {a11y => <select
            {...a11y}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={isLoadingUsers || users.length === 0 || readErrors.users}
            className="min-h-11 min-w-0 w-full rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          >
            <option value="">
              {t(`${copy}.${isLoadingUsers ? "loadingUsers" : "chooseUser"}`)}
            </option>
            {users.map((user) => (
              <option key={user.uid} value={user.uid}>
                {user.displayName || user.email || user.uid}
              </option>
            ))}
          </select>}
        </Field>

        <Field id="ops-enrollment-course" label={t(`${copy}.course`)} error={readErrors.courses ? t(`${copy}.readErrors.courses`) : undefined}>
          {a11y => <select
            {...a11y}
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            disabled={isLoadingCourses || courses.length === 0 || readErrors.courses}
            className="min-h-11 min-w-0 w-full rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          >
            <option value="">
              {t(`${copy}.${isLoadingCourses ? "loadingCourses" : "chooseCourse"}`)}
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>}
        </Field>
      </div>

      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.errors.${error}`)}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" className="mt-5">{t(`${copy}.success.${success}`)}</InlineAlert> : null}

      <button
        type="button"
        onClick={handleCreateEnrollment}
        disabled={isSaving || !userId || !selectedCourse || readErrors.users || readErrors.courses}
        className="button-solid min-h-11 mt-6 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {t(`${copy}.${isSaving ? "creating" : "create"}`)}
      </button>

      <div className="mt-8 border-t border-[var(--color-line)] pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t(`${copy}.grantedTitle`)}
          </h4>
          {!isLoadingGranted && !readErrors.grants ? <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">{t(`${copy}.${grantedEnrollments.length === 1 ? "activeOne" : "active"}`).replace("{count}", () => String(grantedEnrollments.length))}</span> : null}
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t(`${copy}.grantedDescription`)}
        </p>

        {readErrors.grants ? <InlineAlert tone="error" className="mt-4">{t(`${copy}.readErrors.grants`)}</InlineAlert> : null}

        <div className="mt-4 grid gap-3">
          {isLoadingGranted ? (
            <p role="status" className="text-sm text-[var(--color-ink-soft)]">
              {t(`${copy}.loadingGranted`)}
            </p>
          ) : grantedEnrollments.length === 0 ? (
            readErrors.grants ? null : <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
          ) : (
            grantedEnrollments.map((enrollment) => {
              const learner = users.find((user) => user.uid === enrollment.userId);

              return (
                <article
                  key={enrollment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-[var(--color-ink)]">
                      {enrollment.courseTitle}
                    </p>
                    <p className="mt-1 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                      {learner?.displayName || learner?.email || enrollment.userId}
                      {" - "}
                      {t(`${copy}.${enrollment.source === "admin" ? "adminGrant" : "demoGrant"}`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(enrollment)}
                    disabled={revokingId === enrollment.id}
                    className="button-outline min-h-11 px-4 py-2 text-xs disabled:opacity-60"
                  >
                    {t(`${copy}.${revokingId === enrollment.id ? "revoking" : "revoke"}`)}
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
