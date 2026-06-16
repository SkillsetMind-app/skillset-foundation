"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { SkillsetUser } from "@/domain/auth";
import {
  courseEventRsvpStatusLabels,
  courseEventStatusLabels,
  courseEventTypeLabels,
  formatEventDateTime,
  type CourseEvent,
  type CourseEventRsvp,
  type CourseEventRsvpStatus,
} from "@/domain/course-event";
import type { Enrollment } from "@/domain/enrollment";
import { getSafeExternalUrl } from "@/domain/external-url";
import {
  saveCourseEventRsvp,
  subscribeToCourseEventRsvp,
  subscribeToCourseEvents,
} from "@/lib/data/course-events";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";

type EventBuckets = Record<string, CourseEvent[]>;

export function LearnEventsHub() {
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [eventBuckets, setEventBuckets] = useState<EventBuckets>({});
  const [loadedSlugs, setLoadedSlugs] = useState<string[]>([]);
  const [isLoadingEnrollments, setIsLoadingEnrollments] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setIsLoadingEnrollments(false);
      },
      () => {
        setError("We could not load your enrolled courses.");
        setIsLoadingEnrollments(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (enrollments.length === 0) {
      return;
    }

    const uniqueSlugs = Array.from(
      new Set(enrollments.map((enrollment) => enrollment.courseSlug)),
    );

    const unsubscribes = uniqueSlugs.map((courseSlug) =>
      subscribeToCourseEvents(
        courseSlug,
        (events) => {
          setEventBuckets((currentBuckets) => ({
            ...currentBuckets,
            [courseSlug]: events,
          }));
          setLoadedSlugs((currentSlugs) =>
            currentSlugs.includes(courseSlug)
              ? currentSlugs
              : [...currentSlugs, courseSlug],
          );
        },
        () => {
          setError("We could not load one or more course event schedules.");
          setLoadedSlugs((currentSlugs) =>
            currentSlugs.includes(courseSlug)
              ? currentSlugs
              : [...currentSlugs, courseSlug],
          );
        },
      ),
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [enrollments]);

  const currentCourseSlugs = useMemo(
    () => Array.from(new Set(enrollments.map((enrollment) => enrollment.courseSlug))),
    [enrollments],
  );
  const events = useMemo(
    () =>
      currentCourseSlugs
        .flatMap((courseSlug) => eventBuckets[courseSlug] ?? [])
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
    [currentCourseSlugs, eventBuckets],
  );
  const isLoadingEvents =
    currentCourseSlugs.length > 0
    && currentCourseSlugs.some((courseSlug) => !loadedSlugs.includes(courseSlug));

  if (isLoadingEnrollments || isLoadingEvents) {
    return (
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading your event schedule...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[4px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      </section>
    );
  }

  if (enrollments.length === 0) {
    return (
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
          Live learning
        </p>
        <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          Events open after enrollment.
        </h3>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Enroll in a course to see live classes, mentorship sessions, office
          hours, webinars, and course deadlines.
        </p>
        <div className="mt-6">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            Explore programs
          </Link>
        </div>
      </section>
    );
  }

  if (events.length === 0) {
    return (
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
          Your schedule
        </p>
        <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          No live sessions are scheduled yet.
        </h3>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          When instructors schedule live classes, mentorships, office hours, or
          webinars for your enrolled courses, they will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {events.map((event) => (
        <LearnerEventCard
          key={event.id}
          currentUser={user}
          event={event}
        />
      ))}
    </section>
  );
}

function LearnerEventCard({
  currentUser,
  event,
}: {
  currentUser: SkillsetUser | null;
  event: CourseEvent;
}) {
  const [rsvp, setRsvp] = useState<CourseEventRsvp | null>(null);
  const [isLoadingRsvp, setIsLoadingRsvp] = useState(true);
  const [isSavingRsvp, setIsSavingRsvp] = useState(false);
  const [rsvpError, setRsvpError] = useState("");

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    return subscribeToCourseEventRsvp(
      event.id,
      currentUser.uid,
      (nextRsvp) => {
        setRsvp(nextRsvp);
        setIsLoadingRsvp(false);
      },
      () => {
        setRsvpError("We could not load your RSVP for this session.");
        setIsLoadingRsvp(false);
      },
    );
  }, [currentUser, event.id]);

  async function handleRsvp(status: CourseEventRsvpStatus) {
    if (!currentUser) {
      return;
    }

    setRsvpError("");
    setIsSavingRsvp(true);

    try {
      await saveCourseEventRsvp({
        eventId: event.id,
        courseSlug: event.courseSlug,
        status,
        user: currentUser,
      });
    } catch {
      setRsvpError("We could not save your RSVP.");
    } finally {
      setIsSavingRsvp(false);
    }
  }

  const rsvpLabel = rsvp ? courseEventRsvpStatusLabels[rsvp.status] : "No RSVP yet";
  const safeJoinUrl = getSafeExternalUrl(event.externalUrl);

  return (
    <article className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
            {courseEventTypeLabels[event.type]}
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {event.title}
          </h3>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {courseEventStatusLabels[event.status]}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
        {event.courseTitle}
      </p>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        {formatEventDateTime(event.startsAt)}
      </p>
      <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
        {event.description}
      </p>

      <div className="mt-6 rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
          Attendance
        </p>
        <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
          {!currentUser
            ? "Sign in to RSVP"
            : isLoadingRsvp
              ? "Checking your RSVP..."
              : rsvpLabel}
        </p>
        {rsvpError ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-fg)]">
            {rsvpError}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSavingRsvp || isLoadingRsvp || !currentUser}
            onClick={() => handleRsvp("attending")}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isSavingRsvp ? "Saving..." : "I will attend"}
          </button>
          <button
            type="button"
            disabled={isSavingRsvp || isLoadingRsvp || !currentUser}
            onClick={() => handleRsvp("not_attending")}
            className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
          >
            I cannot attend
          </button>
        </div>
      </div>

      {safeJoinUrl ? (
        <a
          href={safeJoinUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="button-solid mt-6 inline-flex px-4 py-2.5 text-sm"
        >
          Join external session
        </a>
      ) : (
        <p className="mt-6 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
          A join link has not been added for this session yet.
        </p>
      )}
    </article>
  );
}
