"use client";

import { Check, ChevronDown } from "lucide-react";
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

// A sessão não tem hora de fim; a mesma janela de "ao vivo" da comunidade.
const LIVE_RUNNING_WINDOW_MS = 3 * 3_600_000;

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
  // As próximas primeiro; as que já passaram ficam numa parte "Past" fechada,
  // da mais recente para a mais antiga. Antes a lista abria pela sessão mais
  // antiga, que já tinha acontecido. A sessão não tem hora de fim: até 3h
  // depois do início ela ainda pode estar rolando e fica em "Upcoming", com o
  // link de entrar à mão (a mesma janela do cartão de live da comunidade).
  // Data inválida ("Date pending") também fica em "Upcoming", no fim.
  const { upcoming, past } = useMemo(() => {
    // Leitura do relógio só para exibir; ficar defasado é inofensivo.
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() - LIVE_RUNNING_WINDOW_MS;
    const split = { upcoming: [] as CourseEvent[], past: [] as CourseEvent[] };
    for (const event of events) {
      const startsAt = Date.parse(event.startsAt);
      (Number.isFinite(startsAt) && startsAt < cutoff ? split.past : split.upcoming).push(event);
    }
    split.past.reverse();
    return split;
  }, [events]);
  const isLoadingEvents =
    currentCourseSlugs.length > 0
    && currentCourseSlugs.some((courseSlug) => !loadedSlugs.includes(courseSlug));

  if (isLoadingEnrollments || isLoadingEvents) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("learnWave2.eventsHub.loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p role="alert" className="rounded-md bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      </section>
    );
  }

  if (enrollments.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.eventsHub.eyebrow")}
        </p>
        <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
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
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.eventsHub.schedule")}
        </p>
        <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
          {t("learnWave2.eventsHub.noSessions")}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.noSessionsDetail")}
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-6">
      <section aria-labelledby="events-upcoming-title" className="grid gap-4">
        <h2 id="events-upcoming-title" className="text-lg font-semibold text-[var(--color-primary)]">
          {t("creatorPanel.events.filter.upcoming")}
        </h2>
        {upcoming.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {upcoming.map((event) => (
              <LearnerEventCard key={event.id} currentUser={user} event={event} />
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
          <summary className="flex min-h-12 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden justify-between gap-3 px-4 text-base font-semibold text-[var(--color-primary)]">
            <span>
              {t("creatorPanel.events.filter.past")}{" "}
              <span className="ml-1 rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5 text-xs font-bold tabular-nums">
                {past.length}
              </span>
            </span>
            <ChevronDown aria-hidden="true" size={18} className="group-open:rotate-180" />
          </summary>
          <div className="grid gap-4 px-4 pb-4 lg:grid-cols-2">
            {past.map((event) => (
              <LearnerEventCard key={event.id} currentUser={user} event={event} isPast />
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
  isPast = false,
}: {
  currentUser: SkillsetUser | null;
  event: CourseEvent;
  isPast?: boolean;
}) {
  const { t, locale } = useTranslation();
  const [rsvp, setRsvp] = useState<CourseEventRsvp | null>(null);
  const [isLoadingRsvp, setIsLoadingRsvp] = useState(true);
  // Qual resposta está sendo salva: o "Saving..." aparece no botão tocado
  // (antes trocava sempre o rótulo de "I will attend", mesmo ao recusar).
  const [savingStatus, setSavingStatus] = useState<CourseEventRsvpStatus | null>(null);
  const isSavingRsvp = savingStatus !== null;
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
    setSavingStatus(status);

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
      setSavingStatus(null);
    }
  }

  const safeJoinUrl = getSafeExternalUrl(event.externalUrl);

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
        <span className="shrink-0 rounded-md bg-[var(--color-surface-soft)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-primary)]">
          {t(`creatorPanel.events.status.${event.status}`)}
        </span>
      </div>
      <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
        <span className="font-semibold text-[var(--color-ink)]">{event.courseTitle}</span>
        {" · "}
        <span>{formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}</span>
      </p>
      {event.description ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {event.description}
        </p>
      ) : null}

      {/* Presença: seletor de duas opções, a escolhida cheia e com o tique
          (aria-pressed). Antes os dois botões tinham a mesma cara qualquer que
          fosse a resposta, e ela só aparecia num quadro de texto acima. Sessão
          que já passou não pede presença. */}
      {isPast ? null : (
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
              const chosen = rsvp?.status === status;
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
            <p role="alert" className="mt-3 rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]">
              {t(rsvpError)}
            </p>
          ) : null}
        </div>
      )}

      {safeJoinUrl ? (
        <a
          href={safeJoinUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="button-solid mt-5 inline-flex px-4 py-2.5 text-sm"
        >
          {t("learnWave2.eventsHub.join")}
        </a>
      ) : (
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          {t("learnWave2.eventsHub.noLink")}
        </p>
      )}
    </article>
  );
}
