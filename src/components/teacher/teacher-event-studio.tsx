"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Plus, X } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { MetricCard } from "@/components/teacher/metric-card";
import { ConfirmDialog, EmptyState, InlineAlert } from "@/components/ui";
import {
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

// Um instante como os valores locais dos campos de data e de hora
// ("YYYY-MM-DD", "HH:mm"), para editar e copiar a sessao na hora certa.
function toLocalDateAndTime(date: Date): [string, string] {
  if (Number.isNaN(date.getTime())) {
    return ["", ""];
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();

  return [local.slice(0, 10), local.slice(11, 16)];
}

// A cidade do fuso do computador ("America/New_York" vira "New York"). E o
// fuso que `new Date(...)` usa para ler o que a pessoa digita. No servidor fica
// vazio: o render do servidor nao sabe o fuso de quem abre a pagina.
const noSubscription = () => () => {};
function useComputerZoneCity(): string {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone?.split("/").pop()?.replace(/_/g, " ") ?? "",
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
  // Data e hora em dois campos (como a criacao do produto "Live event"): o
  // datetime-local vinha em pedacinhos dificeis de editar. Junta como antes:
  // "YYYY-MM-DDTHH:mm", lido no fuso do computador.
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const startsAt = eventDate && eventTime ? `${eventDate}T${eventTime}` : "";
  const [externalUrl, setExternalUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  // Leitura da agenda que falhou nao e agenda vazia: no lugar do "No sessions"
  // (com o convite a criar uma) fica o erro com "Try again".
  const [eventsFailed, setEventsFailed] = useState(false);
  const eventsSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  // Guarda o CODIGO do erro, nao a frase: o efeito de inscricao nao pode
  // depender de `t` (fora do provider ele e uma funcao nova a cada render, e o
  // efeito reinscreveria em laco) e a frase troca de idioma na hora.
  const [error, setError] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  // Como a sessao editada estava: data passada so trava se a pessoa mudou a
  // data, e descricao que ja era vazia (sessao criada junto com o produto)
  // nao obriga a escrever 12 letras so para acrescentar o link.
  const [editingBase, setEditingBase] = useState<{ startsAt: string; descriptionWasEmpty: boolean } | null>(null);
  const [actioningEventId, setActioningEventId] = useState<string | null>(null);
  // Pergunta aberta (cancelar ou excluir) e o aviso de que deu certo: antes a
  // sessao sumia ou mudava de estado sem nenhuma frase dizendo o que houve.
  const [asking, setAsking] = useState<{ action: "cancel" | "delete"; event: CourseEvent } | null>(null);
  const [notice, setNotice] = useState<
    "cancelledNotice" | "deletedNotice" | "scheduledNotice" | "updatedNotice" | null
  >(null);
  // Quantos disseram "vou" em cada sessao, para a janela de excluir dizer
  // quem perde a resposta. Vem da leitura que cada cartao ja faz.
  const [goingByEvent, setGoingByEvent] = useState<Record<string, number>>({});
  const reportGoing = useCallback((eventId: string, count: number) => {
    setGoingByEvent((current) => (current[eventId] === count ? current : { ...current, [eventId]: count }));
  }, []);
  const zoneCity = useComputerZoneCity();
  // O formulario e um pedido, nao a pagina. Quem chega pelo fluxo de criacao de
  // produto (`?newEvent=1`, create-course-start.tsx) ja pediu, e so para essa
  // pessoa ele nasce aberto.
  const [isFormOpen, setIsFormOpen] = useState(
    searchParams.get("newEvent") === "1",
  );
  const [formStep, setFormStep] = useState<1 | 2>(1);
  // Produto da sessao recem-marcada. Antes a pessoa ficava na Agenda sem
  // caminho para preco e publicacao.
  const [nextStepCourseId, setNextStepCourseId] = useState<string | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [search, setSearch] = useState("");
  // O "agora" anda a cada 30 s: a sessao que comeca passa de Upcoming para Past
  // sem recarregar a pagina.
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

    // Releitura que falha com a agenda na tela mantem a lista (so o aviso).
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

  // "Try again" le de novo pelo mesmo canal. Sem agenda na tela, a lista volta
  // ao "carregando"; com agenda (a releitura e que falhou), ela fica.
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

    // A leitura vem da mais antiga para a mais nova. Em "Past" e "All" a
    // sessao que interessa e a mais recente: ela vem primeiro.
    return filter === "past" || filter === "all" ? matching.reverse() : matching;
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

  // "edit" muda a propria sessao; "copy" e "Schedule another like this": o
  // formulario de uma sessao NOVA, igual a esta, uma semana depois (mesma
  // hora do relogio, mesmo com troca de horario de verao no meio). Copiada de
  // uma sessao antiga, pula de semana em semana ate a primeira que ainda nao
  // passou. Nada e gravado ate a pessoa confirmar.
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
        ? { startsAt: date && time ? `${date}T${time}` : "", descriptionWasEmpty: !event.description.trim() }
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
    // Antes das checagens: um "Session deleted." antigo não pode ficar ao
    // lado do erro novo do formulário.
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

    // Data passada gravava sem aviso (ou caia no erro generico do banco). A
    // sessao antiga que a pessoa so corrige, sem mexer na data, segue editavel.
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

    // O mesmo https:// do blur, para quem enviou sem sair do campo.
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
          startsAt: new Date(startsAt).toISOString(),
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

  // Roda só pelo confirmar da janela, que antes era o OK do window.confirm.
  // O pedido em si não mudou.
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

  // Publicado nao precisa do passo; o status vem da inscricao, entao o aviso
  // some sozinho quando o produto for publicado. Em revisao o construtor abre
  // so para leitura: o atalho levaria a uma tela sem nada para fazer.
  const nextStepCourse = courses.find(
    (course) =>
      course.id === nextStepCourseId
      && teacherCanEditCourse(course.status)
      && course.status !== "published",
  );
  // Gratis nao tem preco para definir: o passo e so publicar.
  const nextStepIsFree = nextStepCourse?.paymentType === "free";
  // So o curso exige aula para publicar (publish_teacher_course,
  // 20261007010000). Evento ao vivo, comunidade e e-book publicam sem.
  const nextStepNeedsLesson = nextStepCourse
    ? (nextStepCourse.productFormat ?? "course") === "course"
      && countCourseLessons(nextStepCourse.modules ?? []) === 0
    : false;

  const countLine = t(`${copy}.${visible.length === 1 ? "countOne" : "count"}`)
    .replace("{count}", () => String(visible.length))
    .replace("{filter}", () => t(`${copy}.filter.${filter}`));

  // Erro de data mora junto dos campos de data e hora (e e lido com eles);
  // os outros seguem no aviso do topo.
  const dateError = error === "startsAt" || error === "past";
  const [today] = toLocalDateAndTime(new Date(now));
  const usPreview = formatEventTimeInZones(startsAt, locale, US_PREVIEW_TIME_ZONES);
  const descriptionOptional = Boolean(editingBase?.descriptionWasEmpty);
  const fieldClass =
    "rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";
  // Data e hora maiores que os outros campos: e o que a pessoa mais precisa ler.
  const whenFieldClass =
    "min-h-12 rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-base font-normal outline-none focus:border-[var(--color-primary-light)]";
  const whenDescribedBy = ["event-zone-line", dateError ? "event-when-error" : ""].join(" ").trim();

  return (
    <section className="grid min-w-0 gap-5">
      {/* O quadro de numero da casa. Tres lado a lado so a partir de 480px:
          no celular o rotulo em maiusculas nao cabia num terco da tela. */}
      <dl className="grid gap-3 min-[480px]:grid-cols-3">
        {tiles.map((tile) => (
          <MetricCard
            key={tile.key}
            labelAs="dt"
            label={tile.label}
            loading={!eventsLoaded}
            // Leitura que falhou nao e "0 sessoes": fica o traco.
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

        {/* Erro fora do formulario: cancelar e excluir tambem falham, e com o
            formulario fechado a mensagem ficava invisivel. */}
        {error && !(dateError && isFormOpen) ? (
          <InlineAlert tone="error" className="mt-4">{t(`${copy}.errors.${error}`)}</InlineAlert>
        ) : null}
        {/* Sessao marcada em produto por publicar ja tem a frase no quadro do
            proximo passo, logo abaixo: nao repete. */}
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
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t(`${copy}.courseLabel`)}
                <select
                  value={selectedCourse?.id ?? ""}
                  onChange={(event) => setCourseId(event.target.value)}
                  disabled={courses.length === 0 || isLoading || Boolean(editingEventId)}
                  className="min-w-0 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:opacity-60"
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

              {/* Os mesmos dois campos da criacao do produto "Live event". O
                  minimo de hoje so vale para sessao nova: a sessao que ja
                  passou continua editavel sem mexer na data. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t("courseCreation.eventDate")}
                  <input
                    type="date"
                    min={editingBase ? undefined : today}
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
                {/* De quem e a hora: a do computador, que e o fuso que
                    `new Date(...)` usa para ler o que foi digitado. */}
                <p id="event-zone-line" className="text-sm text-[var(--color-ink-soft)] sm:col-span-2">
                  {zoneCity ? t(`${copy}.timeZoneLine`).replace("{zone}", () => zoneCity) : null}
                </p>
                {dateError ? (
                  <div id="event-when-error" className="sm:col-span-2">
                    <InlineAlert tone="error">{t(`${copy}.errors.${error}`)}</InlineAlert>
                  </div>
                ) : null}
              </div>
              </> : <>
              <p className="break-words text-sm text-[var(--color-ink-soft)]">
                {selectedCourse?.title} · {t(`${copy}.type.${type}`)} · {formatEventDateTime(startsAt, locale, t("platform.events.datePending"))}
              </p>
              {/* Alunos em varios fusos dos EUA: a professora ve, antes de
                  salvar, a hora de cada um. */}
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
                  className="rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>

              {/* type="url": o celular abre o teclado de endereco. Ao sair do
                  campo, "zoom.us/j/1" ganha o https:// que faltava. Prazo nao
                  e reuniao: so ele pode ficar sem link. */}
              <div className="grid gap-2">
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t(`${copy}.urlLabel`)}
                  <input
                    type="url"
                    inputMode="url"
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
                {/* Sem `required` so na sessao que ja tinha descricao vazia; o
                    minimo de 12 letras vale para o que for escrito. */}
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required={!descriptionOptional}
                  minLength={12}
                  rows={4}
                  placeholder={t(`${copy}.descriptionPlaceholder`)}
                  className="resize-none rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
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
                  className="button-solid min-h-11 gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  {isSaving
                    ? t(`${copy}.saving`)
                    : formStep === 1
                      ? t(`${copy}.continue`)
                      : editingEventId
                        ? t(`${copy}.submitEdit`)
                        : t(`${copy}.submitNew`)}
                  {formStep === 1 ? <ArrowRight aria-hidden="true" size={16} /> : null}
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
            className="min-h-11 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
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
            className="min-h-11 min-w-[12rem] flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
          />
          {/* Sem a leitura das sessoes, zero linhas nao quer dizer "agenda vazia". */}
          <ExportTableButton
            rows={exportRows}
            filename="skillset-events"
            disabled={!eventsLoaded || eventsFailed}
            disabledReason={eventsFailed ? t("platform.ops.exportButton.loadFailed") : undefined}
          />
        </div>

        {eventsFailed ? null : <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{countLine}</p>}

        <div className="mt-4 grid gap-3">
          {/* Releitura que falhou com a agenda na tela: a lista fica, e o
              "Try again" vem antes dela (o aviso ja esta no topo). */}
          {eventsLoaded && !eventsFailed && error === "events" ? (
            <button type="button" onClick={retryEvents} className="button-outline justify-self-start px-4 text-sm">
              {t("appErrors.retry")}
            </button>
          ) : null}
          {!eventsLoaded ? (
            <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t(`${copy}.loading`)}
            </p>
          ) : eventsFailed ? (
            // O erro ja esta anunciado no aviso do topo; aqui fica o caminho
            // de volta, no lugar onde a lista apareceria.
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
                  {formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}
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
                  {/* Grupo semanal: a proxima sessao em dois toques, em vez de
                      digitar tudo de novo. */}
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
                      className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      {actioningEventId === event.id
                        ? t(`${copy}.working`)
                        : t(`${copy}.cancelSession`)}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAsking({ action: "delete", event })}
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

      {/* A frase é a mesma do antigo window.confirm; o que muda é a caixa. */}
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
          {/* Excluir apaga as respostas junto e nao avisa ninguem: a pessoa
              sabe quantos perdem a resposta antes de confirmar. */}
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

  // Contagem que nao carregou nao vira "0": a janela de excluir so fala dela
  // quando a leitura chegou.
  useEffect(() => {
    if (!isLoading && !error) onGoingCount(eventId, attendingCount);
  }, [attendingCount, error, eventId, isLoading, onGoingCount]);

  // Nome e e-mail ja chegam nesta leitura (o dono le as respostas pela RLS):
  // quem vai primeiro, depois quem nao vai, cada grupo em ordem de nome.
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
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.rsvpLoading`)}
        </p>
      ) : error ? (
        // Aviso (polite), não erro: a linha se repete em cada cartão de evento,
        // e oito erros assertivos interrompiam o leitor de tela oito vezes.
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
      {/* Antes so os numeros: o professor nao sabia QUEM vinha. A lista abre
          e fecha (details nativo) para nao alongar cada cartao. */}
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
          {/* O botao da casa diz so "Export"; o grupo diz o que sai dele. */}
          <div role="group" aria-label={t(`${copy}.exportAttendees`)} className="mt-3">
            <ExportTableButton rows={exportRows} filename={`attendees-${eventTitle}`} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
