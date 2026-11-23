"use client";

import Image from "next/image";
import Link from "next/link";
import { PlayCircle, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LearningPathsRows } from "@/components/learn/learning-paths-rows";
import { MemberAreaLinks } from "@/components/learn/member-area-links";
import { WelcomeTour } from "@/components/learn/welcome-tour";
import { ListingSearchBar } from "@/components/shared/listing-search-bar";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { noJoinLinkKey, useNow } from "@/components/learn/live-session-parts";
import { formatEventDateTime, getEventLiveState, type CourseEvent } from "@/domain/course-event";
import {
  canContinueEnrollment,
  canOpenEnrollment,
  type Enrollment,
} from "@/domain/enrollment";
import { getSafeExternalUrl } from "@/domain/external-url";
import {
  getRemainingMinutesFrom,
  getResumeCourseLesson,
} from "@/domain/lesson-progress";
import { notificationHref, type AppNotification } from "@/domain/notification";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getCourseBySlug } from "@/lib/data/catalog";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";
import { subscribeToNotifications } from "@/lib/data/notifications";
import {
  fetchCoursesByIds,
  teacherCourseToLearningCourse,
} from "@/lib/data/published-courses";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import {
  automaticRefundProgressCap,
  automaticRefundWindowDays,
} from "@/lib/payments/rules";

const dayMillis = 24 * 60 * 60 * 1000;
const weekMillis = 7 * dayMillis;
// O que o painel destaca no topo: as tres aulas mais recentes para retomar,
// as tres proximas lives e as tres ultimas novidades. O resto fica na grade
// "My courses", no sino e na agenda.
const TOP_ITEMS = 3;
// Busca e filtro de "My courses" so aparecem acima disto: com poucos cursos
// eles so empurram os cartoes para baixo.
const COURSE_CONTROLS_AFTER = 6;

const courseFilters = ["in_progress", "completed"] as const;
type CourseFilter = (typeof courseFilters)[number];

const FALLBACK_COVER = "/brand/logo-mark.png";

export function LearnDashboard() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentQuery, setEnrollmentQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("in_progress");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [eventBuckets, setEventBuckets] = useState<Record<string, CourseEvent[]>>({});
  // Relógio que anda: a live fica no painel enquanto acontece, com "Happening now".
  const now = useNow();
  // Os cursos REAIS da pessoa. Sem isto o painel só enxergava os 6 cursos de
  // demonstração de `catalog.ts`, e uma matrícula real nunca carrega slug de
  // demonstração — `enrollments.ts:115` e o webhook do Stripe gravam o id do
  // curso em `course_slug`. Resultado: `getCourseBySlug` devolvia undefined para
  // 100% das compras reais e o cartão caía no texto de espaço reservado
  // ("Private modules"), justamente na primeira tela depois de pagar.
  // Buscados por id (não o catálogo inteiro) e repassados às fileiras de baixo.
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

  // Antes: os 200 primeiros cursos publicados, inteiros, rebaixados a cada
  // alteração em qualquer curso da plataforma — e um curso despublicado ou fora
  // desses 200 nunca aparecia. Agora só os cursos da pessoa, por id; a chave
  // ignora a re-emissão das matrículas a cada aula salva.
  const enrolledCourseKey = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.courseId).filter(Boolean)),
  )
    .sort()
    .join(",");

  useEffect(() => {
    if (!enrolledCourseKey) {
      return;
    }
    let cancelled = false;
    fetchCoursesByIds(enrolledCourseKey.split(","))
      .then((courses) => {
        if (!cancelled) {
          setRealCourses(courses);
        }
      })
      // Falha aqui não pode derrubar o painel: sem os cursos reais o cartão
      // volta ao texto genérico, que é ruim, mas melhor que uma tela de erro
      // sobre uma compra que existe.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enrolledCourseKey]);

  const enrollmentsSubscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setHasError(false);
        setIsLoading(false);
      },
      () => {
        setHasError(true);
        setIsLoading(false);
      },
    );
    enrollmentsSubscription.current = current;
    return () => {
      enrollmentsSubscription.current = null;
      current();
    };
  }, [user]);

  // "Try again" le de novo pelo mesmo canal. Antes a unica saida do erro era
  // recarregar a pagina no navegador.
  function retryLoad() {
    setHasError(false);
    setIsLoading(true);
    void enrollmentsSubscription.current?.reload();
  }

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

  // A live fica até acabar (a janela comum de course-event.ts). Antes ela
  // saía do painel no minuto em que começava, levando o "Join" junto.
  const upcomingEvents = useMemo(() => {
    return Object.values(eventBuckets)
      .flat()
      .map((event) => ({ event, startsAt: Date.parse(event.startsAt), state: getEventLiveState(event.startsAt, now) }))
      .filter(({ startsAt, state }) => Number.isFinite(startsAt) && state !== "over")
      .sort((left, right) => left.startsAt - right.startsAt)
      .map(({ event, startsAt, state }) => ({
        ...event,
        externalUrl: getSafeExternalUrl(event.externalUrl),
        isThisWeek: startsAt <= now + weekMillis,
        isLive: state === "live",
      }));
  }, [eventBuckets, now]);

  // O aviso de reembolso aparecia em toda visita. Agora so enquanto serve:
  // ha uma compra paga ainda dentro das regras do reembolso automatico. So
  // "payment": assinatura nao gera pedido, entao nao ha o que reembolsar em
  // Purchases. A janela usa createdAt da matricula, nao o paid_at do pedido
  // que o servidor usa: um acesso reconcedido mantem o createdAt antigo e o
  // aviso pode faltar numa recompra elegivel. Billing segue sendo a fonte da
  // verdade; isto e so um atalho.
  const hasRefundablePurchase = useMemo(() => {
    // Same wall-clock read as above: display-only, staleness is harmless.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return enrollments.some(
      (enrollment) =>
        enrollment.source === "payment"
        && canOpenEnrollment(enrollment.status)
        && enrollment.progressPercent < automaticRefundProgressCap
        && now - Date.parse(String(enrollment.createdAt ?? ""))
          <= automaticRefundWindowDays * dayMillis,
    );
  }, [enrollments]);

  const greeting = (
    <h1 className="display-title text-3xl leading-tight text-[var(--color-primary)] sm:text-4xl">
      {firstName
        ? t("learn.dashboard.greetingNamed").replace("{name}", () => firstName)
        : t("learn.dashboard.greeting")}
    </h1>
  );

  if (isLoading) {
    // O esqueleto tem o formato da tela carregada: linha do cabeçalho e o
    // quadro de "My courses" com três cartões (capa 16:10, duas linhas e a
    // barra). Antes eram três caixas soltas sem o quadro, e a página pulava
    // quando as matrículas chegavam.
    const bone = "animate-pulse rounded-md bg-[var(--color-surface-strong)]";
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-8">
        <div className="border-b border-[var(--color-line)] pb-5">
          {greeting}
          <div className={`mt-3 h-4 w-48 ${bone}`} />
        </div>
        <p className="sr-only" role="status">
          {t("learn.dashboard.loading")}
        </p>
        <div className="dash-card dash-card--strong p-4 sm:p-6">
          <div className={`h-6 w-40 ${bone}`} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border fine-rule bg-white p-3">
                <div className={`aspect-[16/10] ${bone}`} />
                <div className={`mt-3 h-3 w-24 ${bone}`} />
                <div className={`mt-2 h-4 w-3/4 ${bone}`} />
                <div className={`mt-3 h-1.5 ${bone}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="grid gap-8">
        {greeting}
        <div className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <InlineAlert tone="error">{t("learn.dashboard.loadError")}</InlineAlert>
          {/* "Try again" e a acao principal; explorar e suporte ficam ao lado. */}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={retryLoad} className="button-solid px-4 py-2.5 text-sm">
              {t("appErrors.retry")}
            </button>
            <Link href="/courses" className="button-outline px-4 py-2.5 text-sm">
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
        {user ? <WelcomeTour key={user.uid} userId={user.uid} firstName={firstName} /> : null}
        {greeting}
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("learn.dashboard.myLearning")}
            </p>
            <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
              {t("learn.dashboard.emptyTitle")}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("learn.dashboard.emptyBody")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
                {t("learn.dashboard.explorePrograms")}
              </Link>
            </div>
          </div>
          <LearningPathsRows enrollments={enrollments} enrolledCourses={realCourses} />
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

  // Um destino so por curso, nos dois lugares em que ele aparece: a area de
  // membros, ja na aula de retomar — direto na aula, nao na capa (?lesson= e
  // o endereco da aula na sala). Antes "My courses" abria a capa. Curso
  // concluido nao tem o que retomar: abre na capa, como antes.
  const courseLink = (enrollment: Enrollment) => {
    const course = resolveCourse(enrollment);
    const resume = course && canContinueEnrollment(enrollment.status)
      ? getResumeCourseLesson(course, enrollment.lastLessonId)
      : null;
    const base = `/learn/courses/${course ? enrollment.courseSlug : enrollment.courseId}`;

    return {
      course,
      resume,
      href: resume ? `${base}?lesson=${encodeURIComponent(resume.lesson.id)}` : base,
    };
  };

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
      const { course, resume, href } = courseLink(enrollment);

      return {
        enrollment,
        resume,
        remainingMinutes:
          course && resume ? getRemainingMinutesFrom(course, resume.lesson.id) : null,
        href,
      };
    });
  // Com ate TOP_ITEMS cursos, "My courses" logo abaixo ja mostra cada um, com
  // o mesmo destino: a fila de retomar so repetiria os mesmos cartoes. Ela
  // volta quando ha mais cursos do que cabem nela.
  const showContinue = continueItems.length > 0 && enrollments.length > TOP_ITEMS;

  const latestNotifications = notifications.slice(0, TOP_ITEMS);
  const nextEvents = upcomingEvents.slice(0, TOP_ITEMS);

  const showCourseControls = enrollments.length > COURSE_CONTROLS_AFTER;
  const normalizedEnrollmentQuery = enrollmentQuery.toLowerCase().trim();
  // "In progress" reune tudo que nao esta concluido, inclusive uma matricula
  // estornada ou expirada: o chip diz o status, e sumir com ela deixaria a
  // pessoa sem saber por que o curso travou. Sem os controles na tela, nada e
  // filtrado: o concluido aparece junto, em vez de sumir atras de uma aba.
  const visibleEnrollments = !showCourseControls
    ? enrollments
    : enrollments
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
      {user ? <WelcomeTour key={user.uid} userId={user.uid} firstName={firstName} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          {greeting}
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {summaryParts.join(" · ")}
          </p>
        </div>
        {/* A agenda saiu da barra lateral (o aluno tem quatro itens fixos):
            o caminho ate ela fica aqui, sempre, com ou sem live marcada —
            e em /learn/events que estao as lives que ja passaram. */}
        <div className="flex flex-wrap items-center gap-2">
          <MemberAreaLinks courses={realCourses} enrollments={enrollments} />
          <Link href="/learn/events" className="button-outline px-4 text-sm">
            {t("learn.dashboard.allEvents")}
          </Link>
          <Link href="/courses" className="button-outline px-4 text-sm">
            {t("learn.dashboard.exploreCourses")}
          </Link>
        </div>
      </header>

      {showContinue ? (
        <section aria-labelledby="continue-watching-title">
          <h2
            id="continue-watching-title"
            className="text-[20px] font-semibold text-[var(--color-primary)]"
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
                    className="group block rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-3 transition hover:-translate-y-0.5 hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-soft)]"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden rounded-md">
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
                      {/* Sobre a foto: a barra da plataforma, recuada e com cantos
                          redondos (antes colada na borda e reta). O número vai
                          em texto no fim do cartão, então a barra fica calada. */}
                      <div aria-hidden="true" className="absolute inset-x-3 bottom-3">
                        <ProgressBar
                          value={percent}
                          label={t("learn.dashboard.percentComplete").replace("{percent}", String(percent))}
                          className="bg-[rgba(255,255,255,0.22)]"
                        />
                      </div>
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

      {/* Sem live marcada a coluna gastava meia linha dizendo isso; agora
          some. "What's new" vazio some do mesmo jeito: o "Nothing new yet."
          empurrava "My courses" para baixo a cada visita. */}
      {nextEvents.length > 0 || latestNotifications.length > 0 ? (
      <div
        className={
          nextEvents.length > 0 && latestNotifications.length > 0
            ? "grid gap-6 lg:grid-cols-2"
            : "grid gap-6"
        }
      >
        {nextEvents.length > 0 ? (
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
            <ul className="mt-3 grid gap-3">
              {nextEvents.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(178,34,52,0.1)] text-[var(--color-accent-fg)]">
                    <Radio aria-hidden="true" size={16} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {event.isLive ? (
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
                        {t("learnWave2.agenda.now")}
                      </p>
                    ) : null}
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                      {formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}
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
                  ) : (
                    <span className="text-xs text-[var(--color-ink-soft)]">
                      {t(noJoinLinkKey(event.type))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {latestNotifications.length > 0 ? (
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
            <ul className="mt-2 divide-y divide-[var(--color-line)]">
              {latestNotifications.map((notification) => (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notificationHref(notification) ?? notification.link}
                      className="block rounded-md transition hover:bg-[var(--color-surface-soft)]"
                    >
                      <NotificationRow notification={notification} />
                    </Link>
                  ) : (
                    <NotificationRow notification={notification} />
                  )}
                </li>
              ))}
            </ul>
        </section>
        ) : null}
      </div>
      ) : null}

      <section
        aria-labelledby="my-courses-title"
        className="dash-card dash-card--strong p-4 shadow-[var(--shadow-soft)] sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id="my-courses-title"
            className="text-[20px] font-semibold text-[var(--color-primary)]"
          >
            {t("learn.dashboard.myCourses")}
          </h2>
          {showCourseControls ? (
            <div className="flex flex-wrap items-center gap-3">
              {/* Filtro de uma lista, nao abas de secao: o seletor segmentado
                  da casa (aria-pressed), o mesmo das credenciais. */}
              <PeriodTabs
                options={courseFilters}
                value={courseFilter}
                onChange={setCourseFilter}
                label={t("learn.dashboard.filterLabel")}
                renderLabel={(value) =>
                  t(value === "completed" ? "learn.dashboard.filterCompleted" : "learn.dashboard.filterInProgress")
                }
              />
              <ListingSearchBar
                value={enrollmentQuery}
                onChange={setEnrollmentQuery}
                placeholder={t("learn.dashboard.searchEnrollments")}
              />
            </div>
          ) : null}
        </div>
        {visibleEnrollments.length === 0 ? (
          <p className="mt-5 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("learn.dashboard.noEnrollmentsMatch")}
          </p>
        ) : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleEnrollments.map((enrollment) => {
              const percent = clampPercent(enrollment.progressPercent);
              const { resume, href } = courseLink(enrollment);
              // O cartão inteiro abre o curso (antes: um botão cheio "Open" por
              // cartão, seis botões azuis iguais com seis cursos). Estornado ou
              // expirado não abre: fica um cartão parado com o selo do status.
              const cardClass = "flex h-full flex-col rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-3";
              const card = (
                <>
                    <div className="relative aspect-[16/10] overflow-hidden rounded-md">
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
                    {/* O progresso uma vez só: a barra com o número ao lado.
                        Antes "40% COMPLETE", o selo "ACTIVE" e a barra diziam
                        a mesma coisa três vezes. */}
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <ProgressBar
                        value={percent}
                        label={t("learn.dashboard.percentComplete").replace("{percent}", String(percent))}
                        className="flex-1"
                      />
                      {/* O leitor de tela ouve o valor pela própria barra. */}
                      <span aria-hidden="true" className="text-xs font-bold tabular-nums text-[var(--color-primary)]">
                        {percent}%
                      </span>
                    </div>
                    {/* O selo só aparece quando há algo a dizer (concluído,
                        estornado, expirado); "ativo" é o normal. */}
                    {enrollment.status !== "active" ? (
                      <StatusChip status={enrollment.status} className="mt-2 self-start" />
                    ) : resume ? (
                      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                        {t("learn.dashboard.resumePosition")
                          .replace("{module}", String(resume.moduleNumber))
                          .replace("{lesson}", String(resume.lessonNumber))}
                      </p>
                    ) : null}
                </>
              );

              return (
                <li key={enrollment.id}>
                  {canOpenEnrollment(enrollment.status) ? (
                    <Link
                      href={href}
                      className={`${cardClass} transition duration-[var(--duration-base)] hover:-translate-y-px hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-soft)]`}
                    >
                      {card}
                    </Link>
                  ) : (
                    <article className={cardClass}>{card}</article>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* O "Request refund" saiu do cartao: dividia a linha com "Open" e
            aparecia toda vez que a pessoa vinha estudar. O pedido ja existe
            em Billing → Purchases, junto do recibo da compra — e o aviso so
            aparece enquanto ha uma compra que ainda pode ser reembolsada. */}
        {hasRefundablePurchase ? (
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
        ) : null}
      </section>

      <LearningPathsRows enrollments={enrollments} enrolledCourses={realCourses} />
    </div>
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
