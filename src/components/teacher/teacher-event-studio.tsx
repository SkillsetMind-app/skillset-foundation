"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Plus, X } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { CardStackSkeleton } from "@/components/teacher/builder-skeleton";
import { MetricCard } from "@/components/teacher/metric-card";
import { BusyLabel, ConfirmDialog, EmptyState, InlineAlert } from "@/components/ui";
import {
  describeTimeZone,
  formatEventDateTime,
  formatEventTimeInZones,
  isEventLinkAcceptable,
  US_PREVIEW_TIME_ZONES,
  withLinkScheme,
  type CourseEvent,
  type CourseEventRsvp,
  type CourseEventType,
} from "@/domain/course-event";
import { getSafeExternalUrl } from "@/domain/external-url";
import {
  countCourseLessons,
  teacherCanEditCourse,
  type TeacherCourse,
} from "@/domain/teacher-course";
import {
  cancelCourseEvent,
  createCourseEvent,
  deleteCourseEvent,
  subscribeToCourseEventRsvps,
  subscribeToTeacherCourseEvents,
  updateCourseEvent,
} from "@/lib/data/course-events";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

const copy = "creatorPanel.events";

const eventTypes: CourseEventType[] = [
  "live_class",
  "mentorship",
  "office_hours",
  "webinar",
  "deadline",
];

const FILTERS = ["upcoming", "past", "cancelled", "all"] as const;
type EventFilter = (typeof FILTERS)[number];

// Three buckets that do not overlap and cover the whole schedule: that is why the three
// tiles at the top add up to the total and each filter has a matching number.
// An unreadable date counts as "upcoming" — hiding the session would be worse than
// showing it with "Date pending".
function bucketOf(event: CourseEvent, now: number): Exclude<EventFilter, "all"> {
  if (event.status === "cancelled") {
    return "cancelled";
  }

  const startsAt = new Date(event.startsAt).getTime();

  if (Number.isNaN(startsAt)) {
    return "upcoming";
  }

  return startsAt < now ? "past" : "upcoming";
}

// An instant as the local values of the date and time fields
// ("YYYY-MM-DD", "HH:mm"), to edit and copy the session at the right time.
function toLocalDateAndTime(date: Date): [string, string] {
  if (Number.isNaN(date.getTime())) {
    return ["", ""];
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();

  return [local.slice(0, 10), local.slice(11, 16)];
}

// The computer's time zone ("America/Chicago"): it is what `new Date(...)` uses to
// read what the person types. On the server it is empty: the server render does not
// know the time zone of whoever opens the page.
const noSubscription = () => () => {};
function useComputerZone(): string {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    () => "",
  );
}

export function TeacherEventStudio() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [courseId, setCourseId] = useState(searchParams.get("courseId") ?? "");
  const [type, setType] = useState<CourseEventType>("live_class");
  const [title, setTitle] = useState("");
  // Date and time in two fields (like the creation of the "Live event" product): the
  // datetime-local came in tiny pieces that were hard to edit. Joined as before:
  // "YYYY-MM-DDTHH:mm", read in the computer's time zone.
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const startsAt = eventDate && eventTime ? `${eventDate}T${eventTime}` : "";
  const [externalUrl, setExternalUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  // A schedule read that failed is not an empty schedule: in place of "No sessions"
  // (with the invitation to create one) comes the error with "Try again".
  const [eventsFailed, setEventsFailed] = useState(false);
  const eventsSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  // Stores the error CODE, not the sentence: the subscription effect cannot
  // depend on `t` (outside the provider it is a new function on every render, and the
  // effect would resubscribe in a loop) and the sentence changes language right away.
  const [error, setError] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  // How the edited session was: a past date only blocks if the person changed the
  // date, and a description that was already empty (session created together with the product)
  // does not force writing 12 letters just to add the link.
  // `storedStartsAt`: the stored instant, returned untouched when the date did not
  // change. Re-reading the local value changed the time on the repeated hour of November
  // (1:30 AM PST became 1:30 AM PDT, an hour earlier).
  const [editingBase, setEditingBase] = useState<
    { startsAt: string; storedStartsAt: string; descriptionWasEmpty: boolean } | null
  >(null);
  const [actioningEventId, setActioningEventId] = useState<string | null>(null);
  // An open question (cancel or delete) and the notice that it worked: before, the
  // session vanished or changed state with no sentence saying what happened.
  const [asking, setAsking] = useState<{ action: "cancel" | "delete"; event: CourseEvent } | null>(null);
  const [notice, setNotice] = useState<
    "cancelledNotice" | "deletedNotice" | "scheduledNotice" | "updatedNotice" | null
  >(null);
  // How many said "I'm going" in each session, so the delete dialog can say
  // who loses their response. It comes from the read that each card already does.
  const [goingByEvent, setGoingByEvent] = useState<Record<string, number>>({});
  const reportGoing = useCallback((eventId: string, count: number) => {
    setGoingByEvent((current) => (current[eventId] === count ? current : { ...current, [eventId]: count }));
  }, []);
  const computerZone = useComputerZone();
  // The form is a request, not the page. Whoever arrives through the product creation
  // flow (`?newEvent=1`, create-course-start.tsx) already asked for it, and only for that
  // person does it start open.
  const [isFormOpen, setIsFormOpen] = useState(
    searchParams.get("newEvent") === "1",
  );
  const [formStep, setFormStep] = useState<1 | 2>(1);
  // Product of the session just scheduled. Before, the person stayed on the Schedule with no
  // path to pricing and publishing.
  const [nextStepCourseId, setNextStepCourseId] = useState<string | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [search, setSearch] = useState("");
  // The "now" ticks every 30 s: a session that starts moves from Upcoming to Past
  // without reloading the page.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isFormOpen) stepHeading.current?.focus();
  }, [formStep, isFormOpen]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoading(false);
      },
      () => {
        setError("courses");
        setIsLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // A re-read that fails with the schedule on screen keeps the list (only the notice).
    let loaded = false;
    const current = subscribeToTeacherCourseEvents(
      user.uid,
      (nextEvents) => {
        loaded = true;
        setEvents(nextEvents);
        setEventsLoaded(true);
        setEventsFailed(false);
        setError((currentError) => (currentError === "events" ? "" : currentError));
      },
      () => {
        setEventsLoaded(true);
        setEventsFailed(!loaded);
        setError("events");
        setNotice(null);
      },
    );
    eventsSubscription.current = current;
    return () => {
      eventsSubscription.current = null;
      current();
    };
  }, [user]);

  // "Try again" reads again through the same channel. With no schedule on screen, the list goes back
  // to "loading"; with a schedule (the re-read is what failed), it stays.
  function retryEvents() {
    if (eventsFailed) {
      setEventsFailed(false);
      setEventsLoaded(false);
    }
    setError((currentError) => (currentError === "events" ? "" : currentError));
    void eventsSubscription.current?.reload();
  }

  const selectedCourse = useMemo(
    () => courseId ? courses.find((course) => course.id === courseId) : courses[0],
    [courseId, courses],
  );

  const counts = useMemo(() => {
    const tally = { upcoming: 0, past: 0, cancelled: 0 };

    events.forEach((event) => {
      tally[bucketOf(event, now)] += 1;
    });

    return tally;
  }, [events, now]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const matching = events.filter((event) => {
      if (filter !== "all" && bucketOf(event, now) !== filter) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return `${event.title} ${event.courseTitle}`.toLowerCase().includes(needle);
    });

    // The read comes from oldest to newest. "Past": most recent
    // first. "All": the ones that are coming, from the next one onward, and then the ones that
    // have passed, from most recent backwards. An unreadable date stays with the ones coming.
    if (filter === "past") {
      return matching.reverse();
    }
    if (filter === "all") {
      const isPast = (event: CourseEvent) => new Date(event.startsAt).getTime() < now;
      return [...matching.filter((event) => !isPast(event)), ...matching.filter(isPast).reverse()];
    }
    return matching;
  }, [events, filter, now, search]);

  const exportRows = useMemo(
    () =>
      visible.map((event) => ({
        event_id: event.id,
        title: event.title,
        course: event.courseTitle,
        type: event.type,
        status: event.status,
        starts_at: event.startsAt,
        external_url: event.externalUrl,
      })),
    [visible],
  );

  function resetForm() {
    setFormStep(1);
    setEditingEventId(null);
    setEditingBase(null);
    setTitle("");
    setEventDate("");
    setEventTime("");
    setExternalUrl("");
    setDescription("");
    setType("live_class");
  }

  function closeForm() {
    resetForm();
    setIsFormOpen(false);
  }

  function openForm() {
    setNotice(null);
    setIsFormOpen(true);
  }

  // "edit" changes the session itself; "copy" is "Schedule another like this": the
  // form of a NEW session, identical to this one, a week later (same
  // clock time, even with a daylight saving change in between). Copied from
  // an old session, it skips week by week until the first one that has not
  // passed yet. Nothing is saved until the person confirms.
  function openPrefilled(event: CourseEvent, mode: "edit" | "copy") {
    const when = new Date(event.startsAt);
    if (mode === "copy") {
      do {
        when.setDate(when.getDate() + 7);
      } while (when.getTime() <= now);
    }
    const [date, time] = toLocalDateAndTime(when);
    setFormStep(1);
    setEditingEventId(mode === "edit" ? event.id : null);
    setEditingBase(
      mode === "edit"
        ? {
            startsAt: date && time ? `${date}T${time}` : "",
            storedStartsAt: event.startsAt,
            descriptionWasEmpty: !event.description.trim(),
          }
        : null,
    );
    setCourseId(event.courseId);
    setType(event.type);
    setTitle(event.title);
    setEventDate(date);
    setEventTime(time);
    setExternalUrl(event.externalUrl);
    setDescription(event.description);
    setError("");
    setNotice(null);
    setIsFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Before the checks: an old "Session deleted." must not stay next to
    // the form's new error.
    setNotice(null);

    if (!user || isSaving || !event.currentTarget.reportValidity()) {
      return;
    }

    if (!editingEventId && !selectedCourse) {
      setError("noCourse");
      return;
    }

    if (!startsAt || !Number.isFinite(new Date(startsAt).getTime())) {
      setError("startsAt");
      setFormStep(1);
      return;
    }

    // A past date used to save without a warning (or fall into the generic database error). An
    // old session that the person only corrects, without touching the date, stays editable.
    const dateChanged = !editingBase || editingBase.startsAt !== startsAt;
    if (dateChanged && new Date(startsAt).getTime() <= Date.now()) {
      setError("past");
      setFormStep(1);
      return;
    }

    if (formStep === 1) {
      setError("");
      setFormStep(2);
      return;
    }

    // The same https:// as on blur, for whoever submitted without leaving the field.
    const link = withLinkScheme(externalUrl);
    if (!isEventLinkAcceptable(type, link)) {
      setError("url");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      if (editingEventId) {
        await updateCourseEvent(editingEventId, {
          title,
          description,
          type,
          startsAt: editingBase && !dateChanged ? editingBase.storedStartsAt : new Date(startsAt).toISOString(),
          externalUrl: link,
        });
        closeForm();
        setNotice("updatedNotice");
      } else {
        if (!selectedCourse) {
          setError("noCourse");
          return;
        }

        await createCourseEvent({
          courseId: selectedCourse.id,
          courseSlug: selectedCourse.id,
          courseTitle: selectedCourse.title,
          ownerId: user.uid,
          title,
          description,
          type,
          startsAt: new Date(startsAt).toISOString(),
          externalUrl: link,
        });

        closeForm();
        setCourseId(selectedCourse.id);
        setNextStepCourseId(selectedCourse.id);
        setNotice("scheduledNotice");
      }
    } catch {
      setError("save");
    } finally {
      setIsSaving(false);
    }
  }

  // Runs only through the dialog's confirm, which used to be the OK of window.confirm.
  // The request itself did not change.
  async function handleCancelEvent(event: CourseEvent) {
    setError("");
    setNotice(null);
    setActioningEventId(event.id);

    try {
      await cancelCourseEvent(event.id);
      setNotice("cancelledNotice");
    } catch {
      setError("cancel");
    } finally {
      setActioningEventId(null);
    }
  }

  async function handleDeleteEvent(event: CourseEvent) {
    setError("");
    setNotice(null);
    setActioningEventId(event.id);

    try {
      await deleteCourseEvent(event.id);

      if (editingEventId === event.id) {
        closeForm();
      }
      setNotice("deletedNotice");
    } catch {
      setError("delete");
    } finally {
      setActioningEventId(null);
    }
  }

  const tiles = [
    {
      key: "upcoming" as const,
      label: t(`${copy}.filter.upcoming`),
      value: counts.upcoming,
      hint: t(`${copy}.tiles.upcomingHint`),
    },
    {
      key: "past" as const,
      label: t(`${copy}.filter.past`),
      value: counts.past,
      hint: t(`${copy}.tiles.pastHint`),
    },
    {
      key: "cancelled" as const,
      label: t(`${copy}.filter.cancelled`),
      value: counts.cancelled,
      hint: t(`${copy}.tiles.cancelledHint`),
    },
  ];

  // A published product does not need the step; the status comes from the subscription, so the notice
  // goes away by itself when the product is published. In review the builder opens
  // read-only: the shortcut would lead to a screen with nothing to do.
  const nextStepCourse = courses.find(
    (course) =>
      course.id === nextStepCourseId
      && teacherCanEditCourse(course.status)
      && course.status !== "published",
  );
  // Free has no price to set: the step is just publish.
  const nextStepIsFree = nextStepCourse?.paymentType === "free";
  // Only a course requires a lesson to publish (publish_teacher_course,
  // 20261007010000). A live event, community and e-book publish without one.
  const nextStepNeedsLesson = nextStepCourse
    ? (nextStepCourse.productFormat ?? "course") === "course"
      && countCourseLessons(nextStepCourse.modules ?? []) === 0
    : false;

  const countLine = t(`${copy}.${visible.length === 1 ? "countOne" : "count"}`)
    .replace("{count}", () => String(visible.length))
    .replace("{filter}", () => t(`${copy}.filter.${filter}`));

  // A date error lives with the date and time fields (and is read with them);
  // the others stay in the notice at the top.
  const dateError = error === "startsAt" || error === "past";
  const [today] = toLocalDateAndTime(new Date(now));
  const usPreview = formatEventTimeInZones(startsAt, locale, US_PREVIEW_TIME_ZONES);
  const descriptionOptional = Boolean(editingBase?.descriptionWasEmpty);
  const zoneLabel = computerZone ? describeTimeZone(computerZone, locale, now) : "";
  const fieldClass = "field-input";
  // Date and time larger than the other fields: it is what the person most needs to read.
  // The app's field is 48px and 16px; the `!` beats the 14px of .field-input, which
  // is outside a layer.
  const whenFieldClass = "field-input min-h-12 text-base!";
  const whenDescribedBy = ["event-zone-line", dateError ? "event-when-error" : ""].join(" ").trim();

  return (
    <section className="grid min-w-0 gap-5">
      {/* The app's number tile. Three side by side only from 480px:
          on a phone the uppercase label did not fit in a third of the screen. */}
      <dl className="grid gap-3 min-[480px]:grid-cols-3">
        {tiles.map((tile) => (
          <MetricCard
            key={tile.key}
            labelAs="dt"
            label={tile.label}
            loading={!eventsLoaded}
            // A read that failed is not "0 sessions": a dash stays.
            unavailable={eventsFailed}
            value={eventsFailed ? "—" : tile.value}
            hint={tile.hint}
            srOnlyHint
          />
        ))}
      </dl>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-[var(--color-ink-soft)]" />
            <h3 className="text-base font-bold text-[var(--color-ink)]">
              {t(`${copy}.sectionTitle`)}
            </h3>
          </div>
          <button
            type="button"
            aria-expanded={isFormOpen}
            aria-controls="event-session-form"
            onClick={() => (isFormOpen ? closeForm() : openForm())}
            disabled={isSaving}
            className={`${isFormOpen ? "button-outline" : "button-solid"} min-h-11 gap-2 px-4 py-2.5 text-sm`}
          >
            {isFormOpen ? <X aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
            {isFormOpen ? t(`${copy}.closeForm`) : t(`${copy}.newSession`)}
          </button>
        </div>

        {/* Error outside the form: cancel and delete fail too, and with the
            form closed the message was invisible. */}
        {error && !(dateError && isFormOpen) ? (
          <InlineAlert tone="error" className="mt-4">{t(`${copy}.errors.${error}`)}</InlineAlert>
        ) : null}
        {/* A session scheduled on a product that is not yet published already has the sentence in the
            next-step tile, right below: it does not repeat. */}
        {notice && !(notice === "scheduledNotice" && nextStepCourse) ? (
          <p role="status" className="info-notice mt-4">
            {t(`${copy}.${notice}`)}
          </p>
        ) : null}

        {nextStepCourse ? (
          <section
            aria-labelledby="event-next-step-title"
            className="mt-4 grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
          >
            <h4 id="event-next-step-title" className="text-base font-semibold text-[var(--color-ink)]">
              {t(`${copy}.nextStep.${nextStepIsFree ? "titleFree" : "title"}`)}
            </h4>
            {nextStepNeedsLesson ? (
              <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
                {t(`${copy}.nextStep.lessonHelp`)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/teach/builder?courseId=${encodeURIComponent(nextStepCourse.id)}&tab=${nextStepIsFree ? "review" : "pricing"}`}
                className="button-solid button-lg w-full sm:w-auto"
              >
                {t(`${copy}.nextStep.${nextStepIsFree ? "publish" : "pricing"}`)}
                <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
              </Link>
              {nextStepNeedsLesson ? (
                <Link
                  href={`/teach/builder?courseId=${encodeURIComponent(nextStepCourse.id)}&tab=content&welcome=1`}
                  className="button-outline button-lg w-full sm:w-auto"
                >
                  {t(`${copy}.nextStep.addLesson`)}
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {isFormOpen ? (
          <div id="event-session-form" className="border-b border-[var(--color-line)] py-5">
            <p className="text-sm font-semibold text-[var(--color-ink-soft)]">
              {editingEventId
                ? t(`${copy}.formTitleEdit`)
                : t(`${copy}.formTitleNew`)}
            </p>
            <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--color-ink-soft)]">
              <li aria-current={formStep === 1 ? "step" : undefined} className={formStep === 1 ? "font-semibold text-[var(--color-ink)]" : undefined}>
                1. {t(`${copy}.stepSchedule`)}
              </li>
              <li aria-current={formStep === 2 ? "step" : undefined} className={formStep === 2 ? "font-semibold text-[var(--color-ink)]" : undefined}>
                2. {t(`${copy}.stepDetails`)}
              </li>
            </ol>
            <h4 ref={stepHeading} tabIndex={-1} className="mt-5 text-base font-semibold text-[var(--color-ink)]">
              {t(`${copy}.${formStep === 1 ? "stepSchedule" : "stepDetails"}`)}
            </h4>

            <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
              {formStep === 1 ? <>
              <div className="grid gap-2">
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.courseLabel`)}
                <select
                  value={selectedCourse?.id ?? ""}
                  onChange={(event) => setCourseId(event.target.value)}
                  disabled={courses.length === 0 || isLoading || Boolean(editingEventId)}
                  aria-describedby={editingEventId ? "event-course-locked" : undefined}
                  className="field-input min-w-0 disabled:opacity-60"
                >
                  {!selectedCourse ? (
                    <option value="" disabled>{t(`${copy}.${courses.length ? "courseUnavailableOption" : "courseEmptyOption"}`)}</option>
                  ) : null}
                  {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                  ))}
                </select>
              </label>
              {/* F-12: the course locks while editing and nothing said why. Outside the
                  <label> so it does not enter the field's name. */}
              {editingEventId ? (
                <span id="event-course-locked" className="text-xs text-[var(--color-ink-muted)]">
                  {t(`${copy}.courseLocked`)}
                </span>
              ) : null}
              </div>

              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.typeLabel`)}
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value as CourseEventType)}
                  className={fieldClass}
                >
                  {eventTypes.map((item) => (
                    <option key={item} value={item}>
                      {t(`${copy}.type.${item}`)}
                    </option>
                  ))}
                </select>
              </label>

              {/* The same two fields as the creation of the "Live event" product. The
                  minimum of today only applies to a new session: a session that has already
                  passed stays editable without touching the date. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t("courseCreation.eventDate")}
                  <input
                    type="date"
                    // Only once the browser's time zone is known: on the server
                    // "today" is the server's date, and that minimum would stay
                    // on the field (an evening in the Americas could not pick today).
                    min={editingBase || !computerZone ? undefined : today}
                    value={eventDate}
                    onChange={(event) => setEventDate(event.target.value)}
                    required
                    aria-invalid={dateError || undefined}
                    aria-describedby={whenDescribedBy}
                    className={whenFieldClass}
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t("courseCreation.eventTime")}
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(event) => setEventTime(event.target.value)}
                    required
                    aria-invalid={dateError || undefined}
                    aria-describedby={whenDescribedBy}
                    className={whenFieldClass}
                  />
                </label>
                {/* Whose time it is: the computer's, which is the time zone that
                    `new Date(...)` uses to read what was typed. */}
                <p id="event-zone-line" className="text-sm text-[var(--color-ink-soft)] sm:col-span-2">
                  {zoneLabel ? t(`${copy}.timeZoneLine`).replace("{zone}", () => zoneLabel) : null}
                </p>
                {dateError ? (
                  <div id="event-when-error" className="sm:col-span-2">
                    <InlineAlert tone="error">{t(`${copy}.errors.${error}`)}</InlineAlert>
                  </div>
                ) : null}
              </div>
              </> : <>
              <p className="break-words text-sm text-[var(--color-ink-soft)]">
                {selectedCourse?.title} · {t(`${copy}.type.${type}`)} · {formatEventDateTime(startsAt, locale, t("platform.events.datePending"), undefined, now)}
              </p>
              {/* Learners in several US time zones: the teacher sees, before
                  saving, the time for each one. */}
              {usPreview.length > 0 ? (
                <p className="break-words text-sm text-[var(--color-ink-soft)]">
                  {t(`${copy}.usPreview`).replace("{times}", () => usPreview.join(" · "))}
                </p>
              ) : null}
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.titleLabel`)}
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  minLength={3}
                  placeholder={t(`${copy}.titlePlaceholder`)}
                  className={fieldClass}
                />
              </label>

              {/* inputMode="url": the phone opens the address keyboard. Without
                  type="url": the browser validation blocked "zoom.us/j/1"
                  (Enter, or a tap on iOS that does not drop focus) before the
                  https:// of the submit. When leaving the field it already goes in. A deadline is not a
                  meeting: only it can go without a link. */}
              <div className="grid gap-2">
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t(`${copy}.urlLabel`)}
                  <input
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={externalUrl}
                    onChange={(event) => setExternalUrl(event.target.value)}
                    onBlur={() => setExternalUrl(withLinkScheme(externalUrl))}
                    required={type !== "deadline"}
                    aria-describedby={type === "deadline" ? "event-link-optional" : undefined}
                    placeholder={t(`${copy}.urlPlaceholder`)}
                    className={fieldClass}
                  />
                </label>
                {type === "deadline" ? (
                  <span id="event-link-optional" className="text-xs text-[var(--color-ink-muted)]">
                    {t(`${copy}.urlOptionalDeadline`)}
                  </span>
                ) : null}
              </div>

              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.descriptionLabel`)}
                {/* No `required` only on a session that already had an empty description; the
                    12-letter minimum applies to whatever is written. */}
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required={!descriptionOptional}
                  minLength={12}
                  rows={4}
                  placeholder={t(`${copy}.descriptionPlaceholder`)}
                  className={`${fieldClass} resize-none`}
                />
              </label>
              </>}

              <div className="flex flex-wrap items-center gap-3">
                {formStep === 2 ? (
                  <button type="button" disabled={isSaving} onClick={() => { setError(""); setFormStep(1); }} className="button-outline min-h-11 gap-2 px-4 py-2.5 text-sm">
                    <ArrowLeft aria-hidden="true" size={16} />{t(`${copy}.back`)}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={isSaving || isLoading || (!editingEventId && !selectedCourse)}
                  // F-12: the reason right below is now read together with the button.
                  aria-describedby={!editingEventId && !selectedCourse && !isLoading ? "event-submit-reason" : undefined}
                  className="button-solid min-h-11 gap-2 px-4 py-2.5 text-sm"
                >
                  {/* Only step 2 saves (step 1 only advances), so the step and the
                      edit do not change during the wait. */}
                  <BusyLabel
                    busy={isSaving}
                    idle={
                      <>
                        {formStep === 1
                          ? t(`${copy}.continue`)
                          : editingEventId
                            ? t(`${copy}.submitEdit`)
                            : t(`${copy}.submitNew`)}
                        {formStep === 1 ? <ArrowRight aria-hidden="true" size={16} /> : null}
                      </>
                    }
                    busyText={t(`${copy}.saving`)}
                  />
                </button>
                {editingEventId ? (
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={isSaving}
                    className="button-outline px-4 py-2.5 text-sm"
                  >
                    {t(`${copy}.cancelEdit`)}
                  </button>
                ) : null}
                {!editingEventId && !selectedCourse && !isLoading ? (
                  <p id="event-submit-reason" className="w-full text-xs text-[var(--color-ink-soft)]">
                    {t(`${copy}.${courses.length ? "courseUnavailableOption" : "needCourse"}`)}
                  </p>
                ) : null}
              </div>
            </form>
          </div>
        ) : null}

        {/* Always-visible frame: even with no session the person sees WHICH
            slice the list is talking about, instead of an empty state with no context (#265). */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label htmlFor="events-filter" className="sr-only">
            {t(`${copy}.filterLabel`)}
          </label>
          <select
            id="events-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as EventFilter)}
            className="field-input field-input--inline"
          >
            {FILTERS.map((option) => (
              <option key={option} value={option}>
                {t(`${copy}.filter.${option}`)}
              </option>
            ))}
          </select>
          <label htmlFor="events-search" className="sr-only">
            {t(`${copy}.searchLabel`)}
          </label>
          {/* min-w-[12rem]: same frame as Sales, same shrinking at 390 px. */}
          <input
            id="events-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(`${copy}.searchPlaceholder`)}
            className="field-input field-input--inline min-w-[12rem] flex-1"
          />
          {/* Without the sessions read, zero rows does not mean "empty schedule". */}
          <ExportTableButton
            rows={exportRows}
            filename="skillset-events"
            disabled={!eventsLoaded || eventsFailed}
            disabledReason={eventsFailed ? t("platform.ops.exportButton.loadFailed") : undefined}
          />
        </div>

        {eventsFailed ? null : <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{countLine}</p>}

        <div className="mt-4 grid gap-3">
          {/* A re-read that failed with the schedule on screen: the list stays, and the
              "Try again" comes before it (the notice is already at the top). */}
          {eventsLoaded && !eventsFailed && error === "events" ? (
            <button type="button" onClick={retryEvents} className="button-outline justify-self-start px-4 text-sm">
              {t("appErrors.retry")}
            </button>
          ) : null}
          {/* Session cards in place of a sentence in a card (T-07). */}
          {!eventsLoaded ? (
            <CardStackSkeleton label={t(`${copy}.loading`)} />
          ) : eventsFailed ? (
            // The error is already announced in the notice at the top; here stays the way
            // back, in the place where the list would appear.
            <button type="button" onClick={retryEvents} className="button-outline justify-self-start px-4 text-sm">
              {t("appErrors.retry")}
            </button>
          ) : visible.length === 0 ? (
            <EmptyState
              title={t(`${copy}.emptyTitle`)}
              description={t(`${copy}.emptyBody`)}
              action={
                <button
                  type="button"
                  onClick={openForm}
                  className="button-solid px-4 py-2.5 text-sm"
                >
                  {t(`${copy}.emptyCta`)}
                </button>
              }
            />
          ) : (
            visible.map((event) => (
              <article
                key={event.id}
                className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      {t(`${copy}.type.${event.type}`)}
                    </p>
                    <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                      {event.title}
                    </h4>
                  </div>
                  <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                    {t(`${copy}.status.${event.status}`)}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
                  {event.courseTitle}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  {formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"), undefined, now)}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                  {event.description}
                </p>
                <TeacherEventRsvpSummary eventId={event.id} eventTitle={event.title} onGoingCount={reportGoing} />
                {getSafeExternalUrl(event.externalUrl) ? (
                  <a
                    href={getSafeExternalUrl(event.externalUrl) ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-4 inline-flex text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-accent-fg)]"
                  >
                    {t(`${copy}.openLink`)}
                  </a>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
                  <button
                    type="button"
                    onClick={() => openPrefilled(event, "edit")}
                    className="button-outline px-3.5 py-2 text-xs"
                  >
                    {t(`${copy}.edit`)}
                  </button>
                  {/* Weekly group: the next session in two taps, instead of
                      typing everything again. */}
                  <button
                    type="button"
                    onClick={() => openPrefilled(event, "copy")}
                    className="button-outline px-3.5 py-2 text-xs"
                  >
                    {t(`${copy}.scheduleAnother`)}
                  </button>
                  {event.status === "scheduled" ? (
                    <button
                      type="button"
                      onClick={() => setAsking({ action: "cancel", event })}
                      disabled={actioningEventId === event.id}
                      className="button-outline px-3.5 py-2 text-xs"
                    >
                      <BusyLabel
                        busy={actioningEventId === event.id}
                        idle={t(`${copy}.cancelSession`)}
                        busyText={t(`${copy}.working`)}
                      />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAsking({ action: "delete", event })}
                    disabled={actioningEventId === event.id}
                    className="button-danger px-3.5 py-2 text-xs"
                  >
                    {t(`${copy}.delete`)}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      {/* The sentence is the same as the old window.confirm; what changes is the box. */}
      {asking ? (
        <ConfirmDialog
          title={t(`${copy}.${asking.action === "cancel" ? "cancelTitle" : "deleteTitle"}`)}
          confirmLabel={t(`${copy}.${asking.action === "cancel" ? "cancelSession" : "deleteSession"}`)}
          pendingLabel={t(`${copy}.working`)}
          cancelLabel={t(`${copy}.keepSession`)}
          danger
          onConfirm={() =>
            asking.action === "cancel"
              ? handleCancelEvent(asking.event)
              : handleDeleteEvent(asking.event)
          }
          onClose={() => setAsking(null)}
        >
          <p>
            {t(`${copy}.${asking.action === "cancel" ? "confirmCancel" : "confirmDelete"}`).replace(
              "{title}",
              () => asking.event.title,
            )}
          </p>
          {/* Deleting erases the responses too and tells nobody: the person
              knows how many lose their response before confirming. */}
          {asking.action === "delete" && (goingByEvent[asking.event.id] ?? 0) > 0 ? (
            <p className="mt-2 font-semibold text-[var(--color-ink)]">
              {t(`${copy}.${goingByEvent[asking.event.id] === 1 ? "deleteGoingOne" : "deleteGoing"}`).replace(
                "{count}",
                () => String(goingByEvent[asking.event.id]),
              )}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function TeacherEventRsvpSummary({
  eventId,
  eventTitle,
  onGoingCount,
}: {
  eventId: string;
  eventTitle: string;
  onGoingCount: (eventId: string, count: number) => void;
}) {
  const { t } = useTranslation();
  const [rsvps, setRsvps] = useState<CourseEventRsvp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    return subscribeToCourseEventRsvps(
      eventId,
      (nextRsvps) => {
        setRsvps(nextRsvps);
        setIsLoading(false);
      },
      () => {
        setError(true);
        setIsLoading(false);
      },
    );
  }, [eventId]);

  const attendingCount = rsvps.filter((rsvp) => rsvp.status === "attending").length;
  const notAttendingCount = rsvps.filter((rsvp) => rsvp.status === "not_attending").length;

  // A count that did not load does not become "0": the delete dialog only speaks of it
  // when the read has arrived.
  useEffect(() => {
    if (!isLoading && !error) onGoingCount(eventId, attendingCount);
  }, [attendingCount, error, eventId, isLoading, onGoingCount]);

  // Name and email already arrive in this read (the owner reads the responses through RLS):
  // those going first, then those not going, each group in name order.
  const answered = [...rsvps].sort(
    (left, right) => Number(left.status !== "attending") - Number(right.status !== "attending"),
  );
  const answerLabel = (rsvp: CourseEventRsvp) => t(`${copy}.answer.${rsvp.status}`);
  const exportRows = answered.map((rsvp) => ({
    name: rsvp.attendeeName,
    email: rsvp.attendeeEmail ?? "",
    answer: answerLabel(rsvp),
  }));

  return (
    <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
        {t(`${copy}.rsvp`)}
      </p>
      {isLoading ? (
        // The shape of the two counts that are coming; the sentence is left for the screen reader.
        <div className="mt-2 flex gap-2">
          <span className="sr-only">{t(`${copy}.rsvpLoading`)}</span>
          <span aria-hidden="true" className="h-7 w-20 animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
          <span aria-hidden="true" className="h-7 w-24 animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
        </div>
      ) : error ? (
        // A notice (polite), not an error: the line repeats on every event card,
        // and eight assertive errors interrupted the screen reader eight times.
        <InlineAlert tone="warning" className="mt-2">{t(`${copy}.rsvpError`)}</InlineAlert>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-md bg-[var(--color-surface-soft)] px-3 py-1 font-semibold text-[var(--color-primary)]">
            {t(`${copy}.going`).replace("{count}", () => String(attendingCount))}
          </span>
          <span className="rounded-md bg-[var(--color-surface-soft)] px-3 py-1 font-semibold text-[var(--color-ink-soft)]">
            {t(`${copy}.notGoing`).replace("{count}", () => String(notAttendingCount))}
          </span>
        </div>
      )}
      {/* Before, only the numbers: the teacher did not know WHO was coming. The list opens
          and closes (native details) so as not to lengthen each card. */}
      {!isLoading && !error && answered.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer py-3 text-sm font-semibold text-[var(--color-primary)]">
            {t(`${copy}.attendeesToggle`)}
          </summary>
          <ul className="grid gap-1 text-sm text-[var(--color-ink)]">
            {answered.map((rsvp) => (
              <li key={rsvp.id} className="break-words">
                {rsvp.attendeeName} · <span className="text-[var(--color-ink-soft)]">{answerLabel(rsvp)}</span>
              </li>
            ))}
          </ul>
          {/* The app's button says only "Export"; the group says what comes out of it. */}
          <div role="group" aria-label={t(`${copy}.exportAttendees`)} className="mt-3">
            <ExportTableButton rows={exportRows} filename={`attendees-${eventTitle}`} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
