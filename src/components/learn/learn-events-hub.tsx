"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { SkillsetUser } from "@/domain/auth";
import {
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
  const { t } = useTranslation();
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
        setError("learnWave2.eventsHub.loadError");
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
          setError("learnWave2.eventsHub.eventsError");
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
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("learnWave2.eventsHub.loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p role="alert" className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      </section>
    );
  }

  if (enrollments.length === 0) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.eventsHub.eyebrow")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          {t("learnWave2.eventsHub.emptyTitle")}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.emptyDetail")}
        </p>
        <div className="mt-6">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            {t("learnWave2.eventsHub.explore")}
          </Link>
        </div>
      </section>
    );
  }

  if (events.length === 0) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.eventsHub.schedule")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          {t("learnWave2.eventsHub.noSessions")}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.noSessionsDetail")}
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
  const { t, locale } = useTranslation();
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
        setRsvpError("learnWave2.eventsHub.rsvpError");
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
      setRsvpError("learnWave2.eventsHub.saveError");
    } finally {
      setIsSavingRsvp(false);
    }
  }

  const rsvpLabel = rsvp ? t(`learnWave2.eventsHub.${rsvp.status}`) : t("learnWave2.eventsHub.noRsvp");
  const safeJoinUrl = getSafeExternalUrl(event.externalUrl);

  return (
    <article className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t(`platform.events.type.${event.type}`)}
          </p>
          <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {event.title}
          </h2>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {t(`platform.events.status.${event.status}`)}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
        {event.courseTitle}
      </p>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        {formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}
      </p>
      <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
        {event.description}
      </p>

      <div className="mt-6 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.attendance")}
        </p>
        <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
          {!currentUser
            ? t("learnWave2.eventsHub.signIn")
            : isLoadingRsvp
              ? t("learnWave2.eventsHub.checking")
              : rsvpLabel}
        </p>
        {rsvpError ? (
          <p role="alert" className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t(rsvpError)}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSavingRsvp || isLoadingRsvp || !currentUser}
            onClick={() => handleRsvp("attending")}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isSavingRsvp ? t("learnWave2.eventsHub.saving") : t("learnWave2.eventsHub.attend")}
          </button>
          <button
            type="button"
            disabled={isSavingRsvp || isLoadingRsvp || !currentUser}
            onClick={() => handleRsvp("not_attending")}
            className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {t("learnWave2.eventsHub.notAttend")}
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
          {t("learnWave2.eventsHub.join")}
        </a>
      ) : (
        <p className="mt-6 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.noLink")}
        </p>
      )}
    </article>
  );
}
