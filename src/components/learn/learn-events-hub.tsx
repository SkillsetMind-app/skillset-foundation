"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { EventCalendarActions, noJoinLinkKey, useNow } from "@/components/learn/live-session-parts";
import { CardListSkeleton } from "@/components/shared/page-skeletons";
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
  // A janela "ao vivo" de course-event.ts com um relógio que anda: a sessão
  // passa para "Past" e a cancelada sai depois de 7 dias sem recarregar.
  const now = useNow();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [eventBuckets, setEventBuckets] = useState<EventBuckets>({});
  const [loadedSlugs, setLoadedSlugs] = useState<string[]>([]);
  const [isLoadingEnrollments, setIsLoadingEnrollments] = useState(true);
  const [error, setError] = useState("");
  // Uma falha por leitura: o "Try again" relê só o que falhou (as matrículas,
  // as agendas que falharam ou os dois), e a agenda nunca aparece vazia por
  // causa de uma agenda que não chegou.
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
        // A cancelada aparece marcada, em vez de sumir sem rastro.
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
  // As próximas primeiro; as que já passaram ficam numa parte "Past" fechada,
  // da mais recente para a mais antiga. Antes a lista abria pela sessão mais
  // antiga, que já tinha acontecido. Enquanto está ao vivo (a janela comum de
  // course-event.ts) a sessão fica em "Upcoming", com o link de entrar à mão.
  // Data inválida ("Date pending") também fica em "Upcoming", no fim.
  const { upcoming, past } = useMemo(() => {
    const split = { upcoming: [] as CourseEvent[], past: [] as CourseEvent[] };
    for (const event of events) {
      // O prazo passa para "Past" na hora em que vence, não 3 h depois.
      (getEventLiveState(event.startsAt, now, event.type) === "over" ? split.past : split.upcoming).push(event);
    }
    split.past.reverse();
    return split;
  }, [events, now]);
  // Matrícula vencida ou reembolsada: o banco deixa de entregar as sessões
  // daquele curso, e a agenda dizia "nenhuma sessão marcada". As matrículas já
  // estão aqui: dá para dizer que o acesso terminou, sem leitura nova.
  const endedCourses = Array.from(
    new Set(enrollments.filter((enrollment) => !canOpenEnrollment(enrollment.status)).map((enrollment) => enrollment.courseTitle)),
  );
  const accessEndedLine = endedCourses.length > 0
    ? t("learnWave2.eventsHub.accessEnded").replace("{courses}", () => endedCourses.join(", "))
    : "";
  const isLoadingEvents =
    currentCourseSlugs.length > 0
    && currentCourseSlugs.some((courseSlug) => !loadedSlugs.includes(courseSlug));

  // Uma moldura em volta de todos os estados (espera, erro, vazio, lista): o
  // "Try again" some ao ser clicado, e o foco vai para ela, que é o mesmo nó do
  // carregando ao resultado. Sem isso o foco caía no <body>.
  const frameRef = useRef<HTMLDivElement>(null);
  const frame = (content: ReactNode) => (
    <div ref={frameRef} tabIndex={-1}>
      {content}
    </div>
  );

  if (isLoadingEnrollments || isLoadingEvents) {
    // O título "Upcoming" e dois cartões, no lugar da frase solta num cartão.
    return frame(<CardListSkeleton label={t("learnWave2.eventsHub.loading")} head="title" />);
  }

  // Lê de novo o que falhou pelos mesmos canais (sem religar). Até a resposta
  // vale o "carregando", nunca o vazio.
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

  // Os dois vazios no EmptyState da plataforma: h2 logo abaixo do h1 do shell.
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
    // Todas as matrículas terminaram: o título diz isso, não "nenhuma sessão".
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
            {/* Cabeçalho próprio: os cartões que já passaram ficam sob "Past",
                não sob "Upcoming", para quem navega por títulos. */}
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
  // Cancelada: marcada, a hora original riscada, sem link e sem presença (o
  // banco nem aceita mudar a resposta de uma sessão cancelada).
  const isCancelled = event.status === "cancelled";
  const isClosed = isPast || isCancelled;
  // Prazo não é reunião: "Due: <data>", "Open link" e, vencido, "Due date
  // passed" (nunca "Happening now" nem "Join").
  const isDeadline = event.type === "deadline";
  const [rsvp, setRsvp] = useState<CourseEventRsvp | null>(null);
  const [isLoadingRsvp, setIsLoadingRsvp] = useState(true);
  // Qual resposta está sendo salva: o "Saving..." aparece no botão tocado
  // (antes trocava sempre o rótulo de "I will attend", mesmo ao recusar).
  const [savingStatus, setSavingStatus] = useState<CourseEventRsvpStatus | null>(null);
  const isSavingRsvp = savingStatus !== null;
  // A resposta salva aparece marcada na hora, sem esperar a volta do tempo
  // real; a próxima leitura do canal assume de novo.
  const [savedStatus, setSavedStatus] = useState<CourseEventRsvpStatus | null>(null);
  const chosenStatus = savedStatus ?? rsvp?.status ?? null;
  const [rsvpError, setRsvpError] = useState("");

  useEffect(() => {
    // Sessão que já passou ou cancelada não mostra presença: não abre um
    // canal por cartão.
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
  // Nada marca a sessão como "completed": a que já passou dizia "Scheduled".
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

      {/* Presença: seletor de duas opções, a escolhida cheia e com o tique
          (aria-pressed). Antes os dois botões tinham a mesma cara qualquer que
          fosse a resposta, e ela só aparecia num quadro de texto acima. Sessão
          que já passou ou cancelada não pede presença. */}
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
                  {savingStatus === status
                    ? t("learnWave2.eventsHub.saving")
                    : t(status === "attending" ? "learnWave2.eventsHub.attend" : "learnWave2.eventsHub.notAttend")}
                </button>
              );
            })}
          </div>
          {rsvpError ? (
            <InlineAlert tone="error" className="mt-3 px-3 py-2">
              {t(rsvpError)}
            </InlineAlert>
          ) : null}
          {/* Depois do "I will attend", um próximo passo: a hora no fuso de
              quem lê e o calendário (antes o botão só ficava marcado). */}
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

      {/* Sessão que já passou ou cancelada: sem "Join" (nem o aviso de link
          que falta). */}
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
