"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Plus, X } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { EmptyState } from "@/components/ui";
import {
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

// Tres baldes que nao se sobrepoem e cobrem a agenda inteira: por isso os tres
// tiles do topo somam o total e cada filtro tem um numero correspondente.
// Data ilegivel conta como "upcoming" — sumir com a sessao seria pior do que
// mostra-la com "Date pending".
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
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [courseId, setCourseId] = useState(searchParams.get("courseId") ?? "");
  const [type, setType] = useState<CourseEventType>("live_class");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  // Guarda o CODIGO do erro, nao a frase: o efeito de inscricao nao pode
  // depender de `t` (fora do provider ele e uma funcao nova a cada render, e o
  // efeito reinscreveria em laco) e a frase troca de idioma na hora.
  const [error, setError] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [actioningEventId, setActioningEventId] = useState<string | null>(null);
  // O formulario e um pedido, nao a pagina. Quem chega pelo fluxo de criacao de
  // produto (`?newEvent=1`, create-course-start.tsx) ja pediu, e so para essa
  // pessoa ele nasce aberto.
  const [isFormOpen, setIsFormOpen] = useState(
    searchParams.get("newEvent") === "1",
  );
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [search, setSearch] = useState("");
  const [now] = useState(() => Date.now());

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

    return subscribeToTeacherCourseEvents(
      user.uid,
      (nextEvents) => {
        setEvents(nextEvents);
        setEventsLoaded(true);
      },
      () => {
        setEventsLoaded(true);
        setError("events");
      },
    );
  }, [user]);

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

    return events.filter((event) => {
      if (filter !== "all" && bucketOf(event, now) !== filter) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return `${event.title} ${event.courseTitle}`.toLowerCase().includes(needle);
    });
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
    setEditingEventId(null);
    setTitle("");
    setStartsAt("");
    setExternalUrl("");
    setDescription("");
    setType("live_class");
  }

  function closeForm() {
    resetForm();
    setIsFormOpen(false);
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
    setIsFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      return;
    }

    if (!isValidExternalEventUrl(externalUrl)) {
      setError("url");
      return;
    }

    if (!startsAt) {
      setError("startsAt");
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
        closeForm();
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
          externalUrl,
        });

        closeForm();
        setCourseId(selectedCourse.id);
      }
    } catch {
      setError("save");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelEvent(event: CourseEvent) {
    const confirmed = window.confirm(
      t(`${copy}.confirmCancel`).replace("{title}", () => event.title),
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setActioningEventId(event.id);

    try {
      await cancelCourseEvent(event.id);
    } catch {
      setError("cancel");
    } finally {
      setActioningEventId(null);
    }
  }

  async function handleDeleteEvent(event: CourseEvent) {
    const confirmed = window.confirm(
      t(`${copy}.confirmDelete`).replace("{title}", () => event.title),
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setActioningEventId(event.id);

    try {
      await deleteCourseEvent(event.id);

      if (editingEventId === event.id) {
        closeForm();
      }
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

  const countLine = t(`${copy}.${visible.length === 1 ? "countOne" : "count"}`)
    .replace("{count}", () => String(visible.length))
    .replace("{filter}", () => t(`${copy}.filter.${filter}`));

  return (
    <section className="grid min-w-0 gap-5">
      <dl className="grid grid-cols-3 divide-x divide-[var(--color-line)] border-y border-[var(--color-line)] py-4">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="min-w-0 px-3 first:pl-0 last:pr-0 sm:px-6"
          >
            <dt className="break-words text-xs font-semibold text-[var(--color-ink-soft)]">
              {tile.label}
            </dt>
            {eventsLoaded ? (
              <dd className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
                {tile.value}
              </dd>
            ) : (
              <dd className="mt-1 h-8 w-10 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            )}
            <dd className="sr-only">
              {tile.hint}
            </dd>
          </div>
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
            onClick={() => (isFormOpen ? closeForm() : setIsFormOpen(true))}
            className={`${isFormOpen ? "button-outline" : "button-solid"} min-h-11 gap-2 px-4 py-2.5 text-sm`}
          >
            {isFormOpen ? <X aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
            {isFormOpen ? t(`${copy}.closeForm`) : t(`${copy}.newSession`)}
          </button>
        </div>

        {/* Erro fora do formulario: cancelar e excluir tambem falham, e com o
            formulario fechado a mensagem ficava invisivel. */}
        {error ? (
          <p role="alert" className="mt-4 rounded-[8px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t(`${copy}.errors.${error}`)}
          </p>
        ) : null}

        {isFormOpen ? (
          <div id="event-session-form" className="border-b border-[var(--color-line)] py-5">
            <h4 className="text-sm font-bold text-[var(--color-ink)]">
              {editingEventId
                ? t(`${copy}.formTitleEdit`)
                : t(`${copy}.formTitleNew`)}
            </h4>

            <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.courseLabel`)}
                <select
                  value={selectedCourse?.id ?? ""}
                  onChange={(event) => setCourseId(event.target.value)}
                  disabled={courses.length === 0 || isLoading || Boolean(editingEventId)}
                  className="min-w-0 w-full rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:opacity-60"
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

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t(`${copy}.typeLabel`)}
                  <select
                    value={type}
                    onChange={(event) => setType(event.target.value as CourseEventType)}
                    className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                  >
                    {eventTypes.map((item) => (
                      <option key={item} value={item}>
                        {t(`${copy}.type.${item}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t(`${copy}.startsAtLabel`)}
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
                {t(`${copy}.titleLabel`)}
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  minLength={3}
                  placeholder={t(`${copy}.titlePlaceholder`)}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.urlLabel`)}
                <input
                  value={externalUrl}
                  onChange={(event) => setExternalUrl(event.target.value)}
                  required
                  placeholder={t(`${copy}.urlPlaceholder`)}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.descriptionLabel`)}
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  minLength={12}
                  rows={4}
                  placeholder={t(`${copy}.descriptionPlaceholder`)}
                  className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={isSaving || (!editingEventId && !selectedCourse)}
                  className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  {isSaving
                    ? t(`${copy}.saving`)
                    : editingEventId
                      ? t(`${copy}.submitEdit`)
                      : t(`${copy}.submitNew`)}
                </button>
                {editingEventId ? (
                  <button
                    type="button"
                    onClick={closeForm}
                    className="button-outline px-4 py-2.5 text-sm"
                  >
                    {t(`${copy}.cancelEdit`)}
                  </button>
                ) : null}
                {!editingEventId && !selectedCourse && !isLoading ? (
                  <p className="w-full text-xs text-[var(--color-ink-soft)]">
                    {t(`${copy}.${courses.length ? "courseUnavailableOption" : "needCourse"}`)}
                  </p>
                ) : null}
              </div>
            </form>
          </div>
        ) : null}

        {/* Moldura sempre visivel: mesmo sem nenhuma sessao a pessoa ve DE QUE
            recorte a lista fala, em vez de um vazio sem contexto (#265). */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label htmlFor="events-filter" className="sr-only">
            {t(`${copy}.filterLabel`)}
          </label>
          <select
            id="events-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as EventFilter)}
            className="min-h-11 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
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
          {/* min-w-[12rem]: mesma moldura de Vendas, mesmo encolhimento a 390 px. */}
          <input
            id="events-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(`${copy}.searchPlaceholder`)}
            className="min-h-11 min-w-[12rem] flex-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
          />
          <ExportTableButton rows={exportRows} filename="skillset-events" />
        </div>

        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{countLine}</p>

        <div className="mt-4 grid gap-3">
          {!eventsLoaded ? (
            <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t(`${copy}.loading`)}
            </p>
          ) : visible.length === 0 ? (
            <EmptyState
              title={t(`${copy}.emptyTitle`)}
              description={t(`${copy}.emptyBody`)}
              action={
                <button
                  type="button"
                  onClick={() => setIsFormOpen(true)}
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
                className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
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
                  <span className="rounded-[8px] bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                    {t(`${copy}.status.${event.status}`)}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
                  {event.courseTitle}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  {formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}
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
                    {t(`${copy}.openLink`)}
                  </a>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
                  <button
                    type="button"
                    onClick={() => startEditing(event)}
                    className="button-outline px-3.5 py-2 text-xs"
                  >
                    {t(`${copy}.edit`)}
                  </button>
                  {event.status === "scheduled" ? (
                    <button
                      type="button"
                      onClick={() => handleCancelEvent(event)}
                      disabled={actioningEventId === event.id}
                      className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      {actioningEventId === event.id
                        ? t(`${copy}.working`)
                        : t(`${copy}.cancelSession`)}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(event)}
                    disabled={actioningEventId === event.id}
                    className="button-danger px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {t(`${copy}.delete`)}
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

  return (
    <div className="mt-4 rounded-[14px] border border-[var(--color-line)] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
        {t(`${copy}.rsvp`)}
      </p>
      {isLoading ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.rsvpLoading`)}
        </p>
      ) : error ? (
        <p className="mt-2 text-sm font-semibold text-[var(--color-accent-fg)]">
          {t(`${copy}.rsvpError`)}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 font-semibold text-[var(--color-primary)]">
            {t(`${copy}.going`).replace("{count}", () => String(attendingCount))}
          </span>
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 font-semibold text-[var(--color-ink-soft)]">
            {t(`${copy}.notGoing`).replace("{count}", () => String(notAttendingCount))}
          </span>
        </div>
      )}
    </div>
  );
}
