"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  courseEventStatusLabels,
  courseEventTypeLabels,
  formatEventDateTime,
  isValidExternalEventUrl,
  type CourseEvent,
  type CourseEventRsvp,
  type CourseEventType,
} from "@/domain/course-event";
import { getSafeExternalUrl } from "@/domain/external-url";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  cancelCourseEvent,
  createCourseEvent,
  deleteCourseEvent,
  subscribeToCourseEventRsvps,
  subscribeToTeacherCourseEvents,
  updateCourseEvent,
} from "@/lib/data/course-events";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

const eventTypes: CourseEventType[] = [
  "live_class",
  "mentorship",
  "office_hours",
  "webinar",
  "deadline",
];

// Convert a stored ISO timestamp into the local "YYYY-MM-DDTHH:mm" value a
// datetime-local input expects, so editing an event pre-fills the right time.
function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function TeacherEventStudio() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [courseId, setCourseId] = useState("");
  const [type, setType] = useState<CourseEventType>("live_class");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [error, setError] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [actioningEventId, setActioningEventId] = useState<string | null>(null);

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
        setError("We could not load your courses for scheduling.");
        setIsLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourseEvents(
      user.uid,
      (nextEvents) => {
        setEvents(nextEvents);
        setEventsLoaded(true);
      },
      () => {
        setEventsLoaded(true);
        setError("We could not load your scheduled sessions.");
      },
    );
  }, [user]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === courseId) ?? courses[0],
    [courseId, courses],
  );

  function resetForm() {
    setEditingEventId(null);
    setTitle("");
    setStartsAt("");
    setExternalUrl("");
    setDescription("");
    setType("live_class");
  }

  function startEditing(event: CourseEvent) {
    setEditingEventId(event.id);
    setCourseId(event.courseId);
    setType(event.type);
    setTitle(event.title);
    setStartsAt(toDateTimeLocalValue(event.startsAt));
    setExternalUrl(event.externalUrl);
    setDescription(event.description);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      return;
    }

    if (!isValidExternalEventUrl(externalUrl)) {
      setError("Use a valid external link, such as a Zoom or Google Meet URL.");
      return;
    }

    if (!startsAt) {
      setError("Choose the date and time for this session.");
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
          startsAt: new Date(startsAt).toISOString(),
          externalUrl,
        });
        resetForm();
      } else {
        if (!selectedCourse) {
          setError("Create a course draft before scheduling a live session.");
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
          externalUrl,
        });

        resetForm();
        setCourseId(selectedCourse.id);
      }
    } catch {
      setError("We could not save this session. Please check the details and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelEvent(event: CourseEvent) {
    const confirmed = window.confirm(
      `Cancel "${event.title}"? Learners who RSVP'd will see it as cancelled.`,
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setActioningEventId(event.id);

    try {
      await cancelCourseEvent(event.id);
    } catch {
      setError("We could not cancel this session.");
    } finally {
      setActioningEventId(null);
    }
  }

  async function handleDeleteEvent(event: CourseEvent) {
    const confirmed = window.confirm(
      `Permanently delete "${event.title}"? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setActioningEventId(event.id);

    try {
      await deleteCourseEvent(event.id);

      if (editingEventId === event.id) {
        resetForm();
      }
    } catch {
      setError("We could not delete this session.");
    } finally {
      setActioningEventId(null);
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <div className="flex items-baseline gap-2 border-b border-[var(--color-line)] pb-4">
          <h3 className="text-base font-bold text-[var(--color-ink)]">
            {editingEventId ? "Edit agenda item" : "Schedule an agenda item"}
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            Course agenda
          </span>
        </div>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          Add a live class, mentorship, masterclass, office hour, webinar, or
          deadline. Learners enrolled in that course see it in their own agenda.
        </p>

        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Course
            <select
              value={selectedCourse?.id ?? ""}
              onChange={(event) => setCourseId(event.target.value)}
              disabled={courses.length === 0 || isLoading || Boolean(editingEventId)}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:opacity-60"
            >
              {courses.length === 0 ? (
                <option value="">Create a course first</option>
              ) : (
                courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              Session type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as CourseEventType)}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
              >
                {eventTypes.map((item) => (
                  <option key={item} value={item}>
                    {courseEventTypeLabels[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              Date and time
              <input
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                type="datetime-local"
                required
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Session title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={3}
                placeholder="Example: Leadership clinic with live Q&A"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            External class link
            <input
              value={externalUrl}
              onChange={(event) => setExternalUrl(event.target.value)}
              required
              placeholder="https://meet.google.com/... or https://zoom.us/..."
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Session description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              minLength={12}
              rows={4}
                placeholder="What should learners expect in this event?"
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>

          {error ? (
            <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSaving || (!editingEventId && !selectedCourse)}
              className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isSaving
                ? "Saving..."
                : editingEventId
                  ? "Update session"
                  : "Schedule session"}
            </button>
            {editingEventId ? (
              <button
                type="button"
                onClick={resetForm}
                className="button-outline px-4 py-2.5 text-sm"
              >
                Cancel edit
              </button>
            ) : null}
            {!editingEventId && !selectedCourse && !isLoading ? (
              <p className="w-full text-xs text-[var(--color-ink-soft)]">
                Create a course draft first — sessions are linked to a specific course.
              </p>
            ) : null}
          </div>
        </form>
      </div>

      <div className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <div className="flex items-baseline gap-2 border-b border-[var(--color-line)] pb-4">
          <h3 className="text-base font-bold text-[var(--color-ink)]">
            Scheduled sessions
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            Agenda
          </span>
        </div>
        <div className="mt-6 grid gap-3">
          {!eventsLoaded ? (
            <p className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              Loading scheduled sessions…
            </p>
          ) : events.length === 0 ? (
            <p className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              No agenda items scheduled yet. Create one when the course has a
              class, mentorship, masterclass, office hour, webinar, or deadline.
            </p>
          ) : (
            events.map((event) => (
              <article
                key={event.id}
                className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      {courseEventTypeLabels[event.type]}
                    </p>
                    <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                      {event.title}
                    </h4>
                  </div>
                  <span className="rounded-[8px] bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                    {courseEventStatusLabels[event.status]}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
                  {event.courseTitle}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  {formatEventDateTime(event.startsAt)}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                  {event.description}
                </p>
                <TeacherEventRsvpSummary eventId={event.id} />
                {getSafeExternalUrl(event.externalUrl) ? (
                  <a
                    href={getSafeExternalUrl(event.externalUrl) ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-4 inline-flex text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-accent-fg)]"
                  >
                    Open external link
                  </a>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
                  <button
                    type="button"
                    onClick={() => startEditing(event)}
                    className="button-outline px-3.5 py-2 text-xs"
                  >
                    Edit
                  </button>
                  {event.status === "scheduled" ? (
                    <button
                      type="button"
                      onClick={() => handleCancelEvent(event)}
                      disabled={actioningEventId === event.id}
                      className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      {actioningEventId === event.id ? "Working..." : "Cancel session"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(event)}
                    disabled={actioningEventId === event.id}
                    className="button-outline px-3.5 py-2 text-xs text-[var(--color-accent-fg)] disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function TeacherEventRsvpSummary({ eventId }: { eventId: string }) {
  const [rsvps, setRsvps] = useState<CourseEventRsvp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToCourseEventRsvps(
      eventId,
      (nextRsvps) => {
        setRsvps(nextRsvps);
        setIsLoading(false);
      },
      () => {
        setError("RSVP summary unavailable.");
        setIsLoading(false);
      },
    );
  }, [eventId]);

  const attendingCount = rsvps.filter((rsvp) => rsvp.status === "attending").length;
  const notAttendingCount = rsvps.filter((rsvp) => rsvp.status === "not_attending").length;

  return (
    <div className="mt-4 rounded-[4px] border border-[var(--color-line)] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
        RSVP
      </p>
      {isLoading ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">Loading attendance...</p>
      ) : error ? (
        <p className="mt-2 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 font-semibold text-[var(--color-primary)]">
            {attendingCount} going
          </span>
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 font-semibold text-[var(--color-ink-soft)]">
            {notAttendingCount} not going
          </span>
        </div>
      )}
    </div>
  );
}
