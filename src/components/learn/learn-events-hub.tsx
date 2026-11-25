"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { EventCalendarActions, noJoinLinkKey, useNow } from "@/components/learn/live-session-parts";
import { CardListSkeleton } from "@/components/shared/page-skeletons";
import { BusyLabel } from "@/components/ui/busy-label";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { SkillsetUser } from "@/domain/auth";
import {
  formatEventDateTime,
  getEventLiveState,
  getEventUpdatedAt,
  isCancelledEventShown,
  type CourseEvent,
  type CourseEventRsvp,
  type CourseEventRsvpStatus,
} from "@/domain/course-event";
import { canOpenEnrollment, type Enrollment } from "@/domain/enrollment";
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
  // The "live" window from course-event.ts with a clock that keeps ticking: the
  // session moves to "Past" and the cancelled one drops off after 7 days, with no reload.
  const now = useNow();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [eventBuckets, setEventBuckets] = useState<EventBuckets>({});
  const [loadedSlugs, setLoadedSlugs] = useState<string[]>([]);
  const [isLoadingEnrollments, setIsLoadingEnrollments] = useState(true);
  const [error, setError] = useState("");
  // One failure per read: "Try again" rereads only what failed (the enrollments,
  // the schedules that failed, or both), and the schedule never shows up empty
  // because of a schedule that did not arrive.
  const [enrollmentsFailed, setEnrollmentsFailed] = useState(false);
  const [failedSlugs, setFailedSlugs] = useState<string[]>([]);
  const enrollmentsSubscription = useRef<{ reload?: () => Promise<void> } | null>(null);
  const eventSubscriptions = useRef(new Map<string, { reload?: () => Promise<void> }>());

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setEnrollmentsFailed(false);
        setIsLoadingEnrollments(false);
      },
      () => {
        setError("learnWave2.eventsHub.loadError");
        setEnrollmentsFailed(true);
        setIsLoadingEnrollments(false);
      },
    );
    enrollmentsSubscription.current = current;
    return () => {
      enrollmentsSubscription.current = null;
      current();
    };
  }, [user]);

  useEffect(() => {
    if (enrollments.length === 0) {
      return;
    }

    const uniqueSlugs = Array.from(
      new Set(enrollments.map((enrollment) => enrollment.courseSlug)),
    );

    const subscriptions = eventSubscriptions.current;
    const unsubscribes = uniqueSlugs.map((courseSlug) => {
      const current = subscribeToCourseEvents(
        courseSlug,
        (events) => {
          setEventBuckets((currentBuckets) => ({
            ...currentBuckets,
            [courseSlug]: events,
          }));
          setFailedSlugs((slugs) => slugs.filter((slug) => slug !== courseSlug));
          setLoadedSlugs((currentSlugs) =>
            currentSlugs.includes(courseSlug)
              ? currentSlugs
              : [...currentSlugs, courseSlug],
          );
        },
        () => {
          setError("learnWave2.eventsHub.eventsError");
          setFailedSlugs((slugs) => (slugs.includes(courseSlug) ? slugs : [...slugs, courseSlug]));
          setLoadedSlugs((currentSlugs) =>
            currentSlugs.includes(courseSlug)
              ? currentSlugs
              : [...currentSlugs, courseSlug],
          );
        },
        // The cancelled one shows up marked, instead of vanishing without a trace.
        { includeCancelled: true },
      );
      subscriptions.set(courseSlug, current);
      return () => {
        subscriptions.delete(courseSlug);
        current();
      };
    });

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
        .filter((event) => event.status !== "cancelled" || isCancelledEventShown(event.startsAt, now))
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
    [currentCourseSlugs, eventBuckets, now],
  );
  // The upcoming ones first; the ones that already happened go in a closed "Past"
  // part, from the most recent to the oldest. Before, the list opened with the
  // oldest session, which had already happened. While it is live (the common
  // window from course-event.ts) the session stays in "Upcoming", with the join link at hand.
  // An invalid date ("Date pending") also stays in "Upcoming", at the end.
  const { upcoming, past } = useMemo(() => {
    const split = { upcoming: [] as CourseEvent[], past: [] as CourseEvent[] };
    for (const event of events) {
      // A deadline moves to "Past" the moment it is due, not 3 h later.
      (getEventLiveState(event.startsAt, now, event.type) === "over" ? split.past : split.upcoming).push(event);
    }
    split.past.reverse();
    return split;
  }, [events, now]);
  // Expired or refunded enrollment: the database stops delivering the sessions
  // of that course, and the schedule said "no session scheduled". The enrollments
  // are already here: we can say the access ended, with no new read.
  const endedCourses = Array.from(
    new Set(enrollments.filter((enrollment) => !canOpenEnrollment(enrollment.status)).map((enrollment) => enrollment.courseTitle)),
  );
  const accessEndedLine = endedCourses.length > 0
    ? t("learnWave2.eventsHub.accessEnded").replace("{courses}", () => endedCourses.join(", "))
    : "";
  const isLoadingEvents =
    currentCourseSlugs.length > 0
    && currentCourseSlugs.some((courseSlug) => !loadedSlugs.includes(courseSlug));

  // One frame around all the states (waiting, error, empty, list): the
  // "Try again" button disappears when clicked, and focus goes to the frame, which is the same node from
  // loading to result. Without it, focus fell back to the <body>.
  const frameRef = useRef<HTMLDivElement>(null);
  const frame = (content: ReactNode) => (
    <div ref={frameRef} tabIndex={-1}>
      {content}
    </div>
  );

  if (isLoadingEnrollments || isLoadingEvents) {
    // The "Upcoming" title and two cards, in place of the loose sentence in a card.
    return frame(<CardListSkeleton label={t("learnWave2.eventsHub.loading")} head="title" />);
  }

  // Rereads what failed through the same channels (without reconnecting). Until the
  // answer arrives, "loading" applies, never the empty state.
  function retryLoad() {
    frameRef.current?.focus();
    setError("");
    if (enrollmentsFailed) {
      setIsLoadingEnrollments(true);
      void enrollmentsSubscription.current?.reload?.();
    }
    if (failedSlugs.length > 0) {
      setFailedSlugs([]);
      setLoadedSlugs((slugs) => slugs.filter((slug) => !failedSlugs.includes(slug)));
      failedSlugs.forEach((slug) => void eventSubscriptions.current.get(slug)?.reload?.());
    }
  }

  if (error) {
    return frame(
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <InlineAlert tone="error">{t(error)}</InlineAlert>
        <button type="button" onClick={retryLoad} className="button-outline mt-4 px-4 text-sm">
          {t("appErrors.retry")}
        </button>
      </section>
    );
  }

  // Both empty states in the platform EmptyState: h2 right below the shell's h1.
  if (enrollments.length === 0) {
    return frame(
      <EmptyState
        as="h2"
        eyebrow={t("learnWave2.eventsHub.eyebrow")}
        title={t("learnWave2.eventsHub.emptyTitle")}
        description={t("learnWave2.eventsHub.emptyDetail")}
        action={
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            {t("learnWave2.eventsHub.explore")}
          </Link>
        }
      />
    );
  }

  const accessEndedNote = accessEndedLine ? (
    <p className="text-sm leading-6 text-[var(--color-ink-soft)]">{accessEndedLine}</p>
  ) : null;

  if (events.length === 0) {
    // All enrollments ended: the title says so, not "no session".
    const allEnded = enrollments.every((enrollment) => !canOpenEnrollment(enrollment.status));
    return frame(
      <EmptyState
        as="h2"
        eyebrow={t("learnWave2.eventsHub.schedule")}
        title={t(allEnded ? "learnWave2.eventsHub.accessEndedTitle" : "learnWave2.eventsHub.noSessions")}
        description={allEnded ? accessEndedLine : t("learnWave2.eventsHub.noSessionsDetail")}
        action={allEnded ? undefined : accessEndedNote}
      />
    );
  }

  return frame(
    <div className="grid gap-6">
      {accessEndedNote}
      <section aria-labelledby="events-upcoming-title" className="grid gap-4">
        <h2 id="events-upcoming-title" className="text-lg font-semibold text-[var(--color-primary)]">
          {t("creatorPanel.events.filter.upcoming")}
        </h2>
        {upcoming.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {upcoming.map((event) => (
              <LearnerEventCard key={event.id} currentUser={user} event={event} now={now} />
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("learnWave2.eventsHub.noSessions")}
          </p>
        )}
      </section>
      {past.length > 0 ? (
        <details className="group rounded-lg border border-[var(--color-line)] bg-white">
          <summary className="flex min-h-12 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden justify-between gap-3 px-4 text-[var(--color-primary)]">
            {/* Its own heading: the cards that already happened sit under "Past",
                not under "Upcoming", for people who navigate by headings. */}
            <h2 className="text-base font-semibold">
              {t("creatorPanel.events.filter.past")}{" "}
              <span className="ml-1 rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5 text-xs font-bold tabular-nums">
                {past.length}
              </span>
            </h2>
            <ChevronDown aria-hidden="true" size={18} className="group-open:rotate-180" />
          </summary>
          <div className="grid gap-4 px-4 pb-4 lg:grid-cols-2">
            {past.map((event) => (
              <LearnerEventCard key={event.id} currentUser={user} event={event} now={now} isPast />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function LearnerEventCard({
  currentUser,
  event,
  now,
  isPast = false,
}: {
  currentUser: SkillsetUser | null;
  event: CourseEvent;
  now: number;
  isPast?: boolean;
}) {
  const { t, locale } = useTranslation();
  // Cancelled: marked, the original time struck through, no link and no attendance (the
  // database does not even accept changing the answer for a cancelled session).
  const isCancelled = event.status === "cancelled";
  const isClosed = isPast || isCancelled;
  // A deadline is not a meeting: "Due: <date>", "Open link" and, once overdue, "Due date
  // passed" (never "Happening now" or "Join").
  const isDeadline = event.type === "deadline";
  const [rsvp, setRsvp] = useState<CourseEventRsvp | null>(null);
  const [isLoadingRsvp, setIsLoadingRsvp] = useState(true);
  // Which answer is being saved: "Saving..." shows on the button that was tapped
  // (before, it always swapped the "I will attend" label, even when declining).
  const [savingStatus, setSavingStatus] = useState<CourseEventRsvpStatus | null>(null);
  const isSavingRsvp = savingStatus !== null;
  // The saved answer shows as marked right away, without waiting for the real-time
  // round trip; the next read from the channel takes over again.
  const [savedStatus, setSavedStatus] = useState<CourseEventRsvpStatus | null>(null);
  const chosenStatus = savedStatus ?? rsvp?.status ?? null;
  const [rsvpError, setRsvpError] = useState("");

  useEffect(() => {
    // A session that already happened or was cancelled does not show attendance: it does not open a
    // channel per card.
    if (!currentUser || isClosed) {
      return;
    }

    return subscribeToCourseEventRsvp(
      event.id,
      currentUser.uid,
      (nextRsvp) => {
        setRsvp(nextRsvp);
        setSavedStatus(null);
        setIsLoadingRsvp(false);
      },
      () => {
        setRsvpError("learnWave2.eventsHub.rsvpError");
        setIsLoadingRsvp(false);
      },
    );
  }, [currentUser, event.id, isClosed]);

  async function handleRsvp(status: CourseEventRsvpStatus) {
    if (!currentUser) {
      return;
    }

    setRsvpError("");
    setSavingStatus(status);

    try {
      await saveCourseEventRsvp({
        eventId: event.id,
        courseSlug: event.courseSlug,
        status,
        user: currentUser,
      });
      setSavedStatus(status);
    } catch {
      setRsvpError("learnWave2.eventsHub.saveError");
    } finally {
      setSavingStatus(null);
    }
  }

  const safeJoinUrl = getSafeExternalUrl(event.externalUrl);
  const when = formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"));
  // Nothing marks the session as "completed": the one that already happened said "Scheduled".
  const statusKey = isCancelled
    ? "creatorPanel.events.status.cancelled"
    : isPast
      ? isDeadline ? "learnWave2.eventsHub.duePassed" : "learnWave2.eventsHub.held"
      : getEventLiveState(event.startsAt, now, event.type) === "live"
        ? "learnWave2.agenda.now"
        : "creatorPanel.events.status.scheduled";
  const updatedAt = isCancelled ? null : getEventUpdatedAt(event);

  return (
    <article className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t(`creatorPanel.events.type.${event.type}`)}
          </p>
          <h3 className="mt-2 text-lg font-semibold leading-6 text-[var(--color-primary)]">
            {event.title}
          </h3>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] ${
            isCancelled
              ? "bg-[var(--color-danger-soft)] text-[var(--color-danger-fg)]"
              : "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
          }`}
        >
          {t(statusKey)}
        </span>
      </div>
      <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
        <span className="font-semibold text-[var(--color-ink)]">{event.courseTitle}</span>
        {" · "}
        {isCancelled ? (
          <s>{when}</s>
        ) : (
          <span>{isDeadline ? t("platform.events.dueBy").replace("{when}", () => when) : when}</span>
        )}
      </p>
      {updatedAt ? (
        <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.updated").replace("{date}", () =>
            formatEventDateTime(updatedAt, locale, t("platform.events.datePending")),
          )}
        </p>
      ) : null}
      {event.description ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {event.description}
        </p>
      ) : null}

      {/* Attendance: a two-option selector, the chosen one filled and with the check
          mark (aria-pressed). Before, both buttons looked the same whatever the
          answer was, and it only showed up in a text box above. A session
          that already happened or was cancelled does not ask for attendance. */}
      {isClosed ? null : (
        <div role="group" aria-label={t("learnWave2.eventsHub.attendance")} className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            {t("learnWave2.eventsHub.attendance")}
          </p>
          {!currentUser ? (
            <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("learnWave2.eventsHub.signIn")}
            </p>
          ) : null}
          <div className="mt-2 inline-flex flex-wrap gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
            {(["attending", "not_attending"] as const).map((status) => {
              const chosen = chosenStatus === status;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={chosen}
                  disabled={isSavingRsvp || isLoadingRsvp || !currentUser}
                  onClick={() => handleRsvp(status)}
                  className={`${
                    chosen
                      ? "button-solid"
                      : "inline-flex min-h-11 items-center rounded-md text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
                  } gap-1.5 px-3.5 text-sm font-semibold disabled:opacity-60`}
                >
                  {chosen ? <Check aria-hidden="true" size={15} /> : null}
                  <BusyLabel
                    busy={savingStatus === status}
                    idle={t(status === "attending" ? "learnWave2.eventsHub.attend" : "learnWave2.eventsHub.notAttend")}
                    busyText={t("learnWave2.eventsHub.saving")}
                  />
                </button>
              );
            })}
          </div>
          {rsvpError ? (
            <InlineAlert tone="error" className="mt-3 px-3 py-2">
              {t(rsvpError)}
            </InlineAlert>
          ) : null}
          {/* After "I will attend", a next step: the time in the reader's
              time zone and the calendar (before, the button was only marked). */}
          {chosenStatus === "attending" ? (
            <div className="mt-4 grid gap-3">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {t("learnWave2.eventsHub.going").replace("{when}", () => when)}
              </p>
              <EventCalendarActions event={event} joinUrl={safeJoinUrl} />
            </div>
          ) : null}
        </div>
      )}

      {/* A session that already happened or was cancelled: no "Join" (nor the notice about the
          missing link). */}
      {isClosed ? null : safeJoinUrl ? (
        <a
          href={safeJoinUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="button-solid mt-5 inline-flex px-4 py-2.5 text-sm"
        >
          {t(isDeadline ? "platform.events.openLink" : "learnWave2.eventsHub.join")}
        </a>
      ) : (
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          {t(noJoinLinkKey(event.type))}
        </p>
      )}
    </article>
  );
}
