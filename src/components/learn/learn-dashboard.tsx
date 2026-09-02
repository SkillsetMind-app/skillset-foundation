"use client";

import Image from "next/image";
import Link from "next/link";
import { PlayCircle, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LearningPathsRows } from "@/components/learn/learning-paths-rows";
import { WelcomeTour } from "@/components/learn/welcome-tour";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { StatusChip } from "@/components/shared/status-chip";
import { formatEventDateTime, type CourseEvent } from "@/domain/course-event";
import {
  canContinueEnrollment,
  canOpenEnrollment,
  type Enrollment,
} from "@/domain/enrollment";
import {
  getRemainingMinutesFrom,
  getResumeCourseLesson,
} from "@/domain/lesson-progress";
import type { AppNotification } from "@/domain/notification";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getCourseBySlug } from "@/lib/data/catalog";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";
import { subscribeToNotifications } from "@/lib/data/notifications";
import {
  subscribeToPublishedTeacherCourses,
  teacherCourseToLearningCourse,
} from "@/lib/data/published-courses";
import { logSubscriptionError } from "@/lib/data/subscription-error";

const weekMillis = 7 * 24 * 60 * 60 * 1000;
// O que o painel destaca no topo: as tres aulas mais recentes para retomar,
// as tres proximas lives e as tres ultimas novidades. O resto fica na grade
// "My courses", no sino e na agenda.
const TOP_ITEMS = 3;

type CourseFilter = "in_progress" | "completed";

const FALLBACK_COVER = "/brand/logo-mark.png";

export function LearnDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentQuery, setEnrollmentQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("in_progress");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [eventBuckets, setEventBuckets] = useState<Record<string, CourseEvent[]>>({});
  // Cursos REAIS publicados. Sem isto o painel só enxergava os 6 cursos de
  // demonstração de `catalog.ts`, e uma matrícula real nunca carrega slug de
  // demonstração — `enrollments.ts:115` e o webhook do Stripe gravam o id do
  // curso em `course_slug`. Resultado: `getCourseBySlug` devolvia undefined para
  // 100% das compras reais e o cartão caía no texto de espaço reservado
  // ("Private modules"), justamente na primeira tela depois de pagar.
  const [realCourses, setRealCourses] = useState<TeacherCourse[]>([]);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";

  // Casa a matrícula com o curso, seja de demonstração ou real.
  //
  // `course_slug` guarda ora o id ora o slug, dependendo do caminho de escrita
  // (`enrollments.ts:69` grava slug, `:115` e o webhook gravam id) — por isso
  // testa as duas formas em vez de assumir uma. Uma migration de hoje já tolera
  // essa ambiguidade no banco; aqui o cliente precisa tolerar igual, senão a
  // metade que resolve o acesso funciona e a que mostra o curso não.
  const resolveCourse = (enrollment: Enrollment) => {
    const demo = getCourseBySlug(enrollment.courseSlug);
    if (demo) return demo;

    const real = realCourses.find(
      (course) =>
        course.id === enrollment.courseId
        || course.id === enrollment.courseSlug,
    );
    return real ? teacherCourseToLearningCourse(real) : undefined;
  };

  useEffect(() => {
    // Falha aqui não pode derrubar o painel: sem os cursos reais o cartão volta
    // ao texto genérico, que é ruim, mas melhor que uma tela de erro sobre uma
    // compra que existe.
    return subscribeToPublishedTeacherCourses(setRealCourses, () => undefined);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setIsLoading(false);
      },
      () => {
        setHasError(true);
        setIsLoading(false);
      },
    );
  }, [user]);

  // Mesma fonte do sino: o que chegou de novo (resposta na comunidade,
  // mensagem do professor, certificado) so aparecia atras de um clique no
  // sino; agora as tres ultimas ficam na cara, no painel.
  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToNotifications(
      user.uid,
      setNotifications,
      () => setNotifications([]),
    );
  }, [user]);

  useEffect(() => {
    if (enrollments.length === 0) {
      return;
    }

    const uniqueSlugs = Array.from(
      new Set(enrollments.map((enrollment) => enrollment.courseSlug)),
    );

    try {
      const unsubscribes = uniqueSlugs.map((courseSlug) =>
        subscribeToCourseEvents(
          courseSlug,
          (events) =>
            setEventBuckets((current) => ({ ...current, [courseSlug]: events })),
          logSubscriptionError(`LearnDashboard.courseEvents[${courseSlug}]`),
        ),
      );

      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    } catch (error) {
      // A agenda e complemento: sem ela a coluna diz que nao ha live, e o
      // resto do painel segue de pe.
      console.warn("LearnDashboard: course events subscription unavailable", error);
    }
  }, [enrollments]);

  const upcomingEvents = useMemo(() => {
    // Display-only metric recomputed whenever event data changes; reading the
    // wall clock here is intentional and any staleness is harmless.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return Object.values(eventBuckets)
      .flat()
      .map((event) => ({ event, startsAt: Date.parse(event.startsAt) }))
      .filter(({ startsAt }) => Number.isFinite(startsAt) && startsAt >= now)
      .sort((left, right) => left.startsAt - right.startsAt)
      .map(({ event, startsAt }) => ({
        ...event,
        isThisWeek: startsAt <= now + weekMillis,
      }));
  }, [eventBuckets]);

  const greeting = (
    <h1 className="display-title text-3xl leading-tight text-[var(--color-primary)] sm:text-4xl">
      {firstName
        ? t("learn.dashboard.greetingNamed").replace("{name}", firstName)
        : t("learn.dashboard.greeting")}
    </h1>
  );

  if (isLoading) {
    // Skeleton mirrors the loaded shape (continue row + course grid) so the
    // layout does not jump when the enrollments arrive. Same animate-pulse
    // blocks the rest of the app already uses; the sr-only status keeps the
    // old copy.
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-8">
        {greeting}
        <p className="sr-only" role="status">
          {t("learn.dashboard.loading")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-56 animate-pulse rounded-[14px] border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]"
            />
          ))}
        </div>
        <div className="h-44 animate-pulse rounded-[14px] bg-[var(--color-surface-soft)]" />
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="grid gap-8">
        {greeting}
        <div className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t("learn.dashboard.loadError")}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
              {t("learn.dashboard.exploreCourses")}
            </Link>
            <Link href="/support" className="button-outline px-4 py-2.5 text-sm">
              {t("learn.dashboard.contactSupport")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="grid gap-8">
        {user ? <WelcomeTour userId={user.uid} firstName={firstName} /> : null}
        {greeting}
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("learn.dashboard.myLearning")}
            </p>
            <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
              {t("learn.dashboard.emptyTitle")}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("learn.dashboard.emptyBody")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
                {t("learn.dashboard.explorePrograms")}
              </Link>
              <Link href="/platform" className="button-outline px-4 py-2.5 text-sm">
                {t("learn.dashboard.viewPlatformOverview")}
              </Link>
            </div>
          </div>
          <LearningPathsRows enrollments={enrollments} />
        </div>
      </div>
    );
  }

  const inProgressCount = enrollments.filter((enrollment) =>
    canContinueEnrollment(enrollment.status),
  ).length;
  const liveThisWeekCount = upcomingEvents.filter((event) => event.isThisWeek).length;
  // Os tres cartoes de metrica ("1 · 0 · 0") ocupavam uma linha inteira antes
  // dos cursos. Viram uma frase sob a saudacao; a live so entra quando existe.
  const summaryParts = [
    t(
      inProgressCount === 1
        ? "learn.dashboard.summaryInProgressSingular"
        : "learn.dashboard.summaryInProgressPlural",
    ).replace("{count}", String(inProgressCount)),
    liveThisWeekCount > 0
      ? t(
          liveThisWeekCount === 1
            ? "learn.dashboard.summaryLiveSingular"
            : "learn.dashboard.summaryLivePlural",
        ).replace("{count}", String(liveThisWeekCount))
      : null,
  ].filter(Boolean);

  // "Continue watching": o mais recente primeiro, como numa fila de video.
  // updatedAt e ISO vindo do Postgres, entao a comparacao de texto ordena por
  // data; matriculas sem carimbo empatam e caem para o progresso.
  const continueItems = enrollments
    .filter((enrollment) => canContinueEnrollment(enrollment.status))
    .sort(
      (left, right) =>
        String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""))
        || right.progressPercent - left.progressPercent,
    )
    .slice(0, TOP_ITEMS)
    .map((enrollment) => {
      const course = resolveCourse(enrollment);
      const resume = course
        ? getResumeCourseLesson(course, enrollment.lastLessonId)
        : null;
      const remainingMinutes =
        course && resume ? getRemainingMinutesFrom(course, resume.lesson.id) : null;
      const base = `/learn/courses/${course ? enrollment.courseSlug : enrollment.courseId}`;

      return {
        enrollment,
        resume,
        remainingMinutes,
        // Direto na aula, nao na capa: ?lesson= ja e o endereco da aula na
        // sala (item 4).
        href: resume ? `${base}?lesson=${encodeURIComponent(resume.lesson.id)}` : base,
      };
    });

  const latestNotifications = notifications.slice(0, TOP_ITEMS);
  const nextEvents = upcomingEvents.slice(0, TOP_ITEMS);

  const normalizedEnrollmentQuery = enrollmentQuery.toLowerCase().trim();
  // "In progress" reune tudo que nao esta concluido, inclusive uma matricula
  // estornada ou expirada: o chip diz o status, e sumir com ela deixaria a
  // pessoa sem saber por que o curso travou.
  const visibleEnrollments = enrollments
    .filter((enrollment) =>
      courseFilter === "completed"
        ? enrollment.status === "completed"
        : enrollment.status !== "completed",
    )
    .filter((enrollment) =>
      normalizedEnrollmentQuery
        ? `${enrollment.courseTitle} ${enrollment.courseCategory} ${enrollment.status}`
            .toLowerCase()
            .includes(normalizedEnrollmentQuery)
        : true,
    );

  return (
    <div className="grid gap-8">
      {user ? <WelcomeTour userId={user.uid} firstName={firstName} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          {greeting}
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {summaryParts.join(" · ")}
          </p>
        </div>
        <Link href="/courses" className="button-outline px-4 text-sm">
          {t("learn.dashboard.exploreCourses")}
        </Link>
      </header>

      {continueItems.length > 0 ? (
        <section aria-labelledby="continue-watching-title">
          <h2
            id="continue-watching-title"
            className="display-title text-2xl text-[var(--color-primary)]"
          >
            {t("learn.dashboard.continueWatching")}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {continueItems.map(({ enrollment, resume, remainingMinutes, href }) => {
              const percent = clampPercent(enrollment.progressPercent);
              const meta = [
                resume
                  ? t("learn.dashboard.resumePosition")
                      .replace("{module}", String(resume.moduleNumber))
                      .replace("{lesson}", String(resume.lessonNumber))
                  : null,
                remainingMinutes !== null
                  ? t("learn.dashboard.minutesLeft").replace(
                      "{minutes}",
                      String(remainingMinutes),
                    )
                  : null,
              ].filter(Boolean);

              return (
                <li key={enrollment.id}>
                  <Link
                    href={href}
                    className="group block rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3 transition hover:-translate-y-0.5 hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-soft)]"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[10px]">
                      <Image
                        src={enrollment.courseImage || FALLBACK_COVER}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                      />
                      <span className="absolute inset-0 grid place-items-center bg-[rgba(15,39,68,0.28)] text-white transition group-hover:bg-[rgba(15,39,68,0.4)]">
                        <PlayCircle aria-hidden="true" size={40} strokeWidth={1.6} />
                      </span>
                      <span className="absolute inset-x-0 bottom-0 h-1.5 bg-[rgba(255,255,255,0.4)]">
                        <span
                          className="block h-full bg-[var(--color-accent)]"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-1 text-sm font-semibold text-[var(--color-primary)]">
                      {enrollment.courseTitle}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
                      {meta.join(" · ")}
                      <span className="sr-only">
                        {" "}
                        {t("learn.dashboard.percentComplete").replace(
                          "{percent}",
                          String(percent),
                        )}
                      </span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="upcoming-lives-title"
          className="dash-card dash-card--strong p-4 sm:p-5"
        >
          <h2
            id="upcoming-lives-title"
            className="text-lg font-semibold text-[var(--color-primary)]"
          >
            {t("learn.dashboard.upcomingLives")}
          </h2>
          {nextEvents.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("learn.dashboard.noUpcomingLives")}
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {nextEvents.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(178,34,52,0.1)] text-[var(--color-accent-fg)]">
                    <Radio aria-hidden="true" size={16} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                      {formatEventDateTime(event.startsAt)}
                    </p>
                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                      {event.title}
                    </p>
                    <p className="truncate text-xs text-[var(--color-ink-soft)]">
                      {event.courseTitle}
                    </p>
                  </div>
                  {event.externalUrl ? (
                    <a
                      href={event.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="button-solid px-4 text-sm"
                    >
                      {t("learn.dashboard.joinLive")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="whats-new-title"
          className="dash-card dash-card--strong p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="whats-new-title"
              className="text-lg font-semibold text-[var(--color-primary)]"
            >
              {t("learn.dashboard.whatsNew")}
            </h2>
            <Link
              href="/account/notifications"
              className="text-xs font-semibold text-[var(--color-primary)] hover:underline"
            >
              {t("learn.dashboard.seeAllNotifications")}
            </Link>
          </div>
          {latestNotifications.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("learn.dashboard.nothingNew")}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-line)]">
              {latestNotifications.map((notification) => (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      className="block rounded-[10px] transition hover:bg-[var(--color-surface-soft)]"
                    >
                      <NotificationRow notification={notification} />
                    </Link>
                  ) : (
                    <NotificationRow notification={notification} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        aria-labelledby="my-courses-title"
        className="dash-card dash-card--strong p-4 shadow-[var(--shadow-soft)] sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id="my-courses-title"
            className="display-title text-2xl text-[var(--color-primary)]"
          >
            {t("learn.dashboard.myCourses")}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="tablist"
              aria-label={t("learn.dashboard.filterLabel")}
              className="flex items-center gap-1 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-1"
            >
              {(["in_progress", "completed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={courseFilter === value}
                  onClick={() => setCourseFilter(value)}
                  className={`min-h-11 rounded-[8px] px-4 text-xs font-semibold transition ${
                    courseFilter === value
                      ? "bg-white text-[var(--color-primary)] shadow-[var(--shadow-soft)]"
                      : "text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
                  }`}
                >
                  {t(
                    value === "completed"
                      ? "learn.dashboard.filterCompleted"
                      : "learn.dashboard.filterInProgress",
                  )}
                </button>
              ))}
            </div>
            <ListingSearchBar
              value={enrollmentQuery}
              onChange={setEnrollmentQuery}
              placeholder={t("learn.dashboard.searchEnrollments")}
            />
          </div>
        </div>
        {visibleEnrollments.length === 0 ? (
          <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("learn.dashboard.noEnrollmentsMatch")}
          </p>
        ) : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleEnrollments.map((enrollment) => {
              const course = resolveCourse(enrollment);
              const workspaceHref = `/learn/courses/${
                course ? enrollment.courseSlug : enrollment.courseId
              }`;
              const canOpenWorkspace = canOpenEnrollment(enrollment.status);
              const percent = clampPercent(enrollment.progressPercent);

              return (
                <li key={enrollment.id}>
                  <article className="flex h-full flex-col rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3">
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[10px]">
                      <Image
                        // Same fallback the write path uses (lib/data/enrollments.ts).
                        // Legacy rows predate it, and an empty src throws in next/image,
                        // which would blank the whole dashboard over one bad row.
                        src={enrollment.courseImage || FALLBACK_COVER}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
                      {enrollment.courseCategory}
                    </p>
                    <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-5 text-[var(--color-primary)]">
                      {enrollment.courseTitle}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                        {t("learn.dashboard.percentComplete").replace(
                          "{percent}",
                          String(percent),
                        )}
                      </p>
                      <StatusChip status={enrollment.status} />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)]"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="mt-auto pt-3">
                      {canOpenWorkspace ? (
                        <Link
                          href={workspaceHref}
                          className="button-solid w-full px-4 text-sm"
                        >
                          {t("learn.dashboard.openWorkspace")}
                        </Link>
                      ) : (
                        <p className="text-xs font-semibold text-[var(--color-ink-soft)]">
                          {t("learn.dashboard.accessStatus").replace(
                            "{status}",
                            t(`statusChip.${enrollment.status}`),
                          )}
                        </p>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
        {/* O "Request refund" saiu do cartao: dividia a linha com "Open" e
            aparecia toda vez que a pessoa vinha estudar. O pedido ja existe
            em Billing → Purchases, junto do recibo da compra. */}
        <p className="mt-5 text-xs leading-5 text-[var(--color-ink-soft)]">
          {t("learn.dashboard.refundsMoved")}{" "}
          <Link
            href="/account/billing?tab=purchases"
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            {t("learn.dashboard.refundsMovedLink")}
          </Link>
          .
        </p>
      </section>

      <LearningPathsRows enrollments={enrollments} />
    </div>
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
