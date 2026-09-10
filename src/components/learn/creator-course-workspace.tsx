"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import { canOpenEnrollment, type Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { teacherCourseToLearningCourse } from "@/lib/data/published-courses";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";
import { subscribeToTeacherCourse } from "@/lib/data/teacher-courses";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

export function CreatorCourseWorkspace({
  initialCourseId,
  whitelabel = false,
  tab = "lesson",
  openPostId = null,
}: {
  initialCourseId?: string;
  /** Forwarded from the member-area shell: the course is opening under a
   *  teacher's own brand, so every link back into our platform stays hidden. */
  whitelabel?: boolean;
  /** A aba da sala aberta pela rota (lesson | materials | community...). */
  tab?: ClassroomTab;
  /** Um post da comunidade aberto na gaveta. */
  openPostId?: string | null;
}) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const courseId = initialCourseId ?? searchParams.get("courseId") ?? "";
  // Stripe's success_url lands here with ?checkout=success BEFORE the webhook
  // has created the enrollment row. During that gap the buyer must see a
  // "finalizing" state — not "Enrollment required" — and the workspace opens
  // as soon as a re-check finds the row the webhook committed.
  const cameFromCheckout = searchParams.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollmentRecheck, setEnrollmentRecheck] = useState(0);
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const { user } = useAuth();
  const [enrollmentState, setEnrollmentState] = useState<{
    enrollment: Enrollment | null;
    key: string | null;
    ready: boolean;
  }>({
    enrollment: null,
    key: null,
    ready: false,
  });
  const [courseState, setCourseState] = useState<{
    course: TeacherCourse | null;
    key: string | null;
    ready: boolean;
  }>({
    course: null,
    key: null,
    ready: false,
  });
  const [error, setError] = useState("");
  const enrollment =
    enrollmentState.key === courseId ? enrollmentState.enrollment : null;
  const canOpenCourse = enrollment ? canOpenEnrollment(enrollment.status) : false;
  const course = courseState.key === courseId ? courseState.course : null;
  const isLoadingEnrollment = Boolean(
    user
      && courseId
      && hasBackendConfig
      && (!enrollmentState.ready || enrollmentState.key !== courseId),
  );
  const isLoadingCourse = Boolean(
    canOpenCourse && (!courseState.ready || courseState.key !== courseId),
  );

  useEffect(() => {
    if (!cameFromCheckout) {
      return;
    }

    // Webhook fulfilment normally lands in seconds; after 90s without an
    // enrollment something is genuinely stuck and the copy should say so
    // instead of spinning forever.
    const timer = window.setTimeout(() => setCheckoutGraceExpired(true), 90_000);

    return () => window.clearTimeout(timer);
  }, [cameFromCheckout]);

  // Belt and braces for the checkout gap. public.enrollments IS in the
  // supabase_realtime publication, so subscribeToEnrollment normally delivers
  // the webhook's row over postgres_changes — but that path is a WebSocket,
  // and a dropped socket, a blocking proxy or a backgrounded mobile tab all
  // fail silently: the channel stays subscribed and simply never fires. The
  // buyer has already paid, so "silently stuck until the 90s grace expires" is
  // the one outcome worth paying a poll to avoid. Bumping this counter re-runs
  // the subscription effect below, which re-issues its one-shot read. The deps
  // double as the stop conditions: React clears the interval the moment the
  // enrollment arrives, the grace window closes, or the component unmounts.
  useEffect(() => {
    if (!cameFromCheckout || enrollment) {
      return;
    }

    // O poll NÃO para aos 90s. Antes parava — `checkoutGraceExpired` era
    // condição de saída daqui — e isso desligava o fallback exatamente no
    // instante em que ele passa a ser a única coisa que pode funcionar: passar
    // dos 90s é justamente o sinal de que o WebSocket não entregou. Depois da
    // carência a tela promete "it opens automatically the moment your
    // enrollment is confirmed", e o socket morto era o único caminho restante
    // para cumprir isso. Quem já pagou ficava preso até recarregar na mão.
    //
    // A carência agora só muda o RITMO: 5s enquanto é rápido, 20s depois — um
    // webhook atrasado (retry do Stripe, fila cheia) ainda aterrissa.
    const interval = window.setInterval(
      () => setEnrollmentRecheck((tick) => tick + 1),
      checkoutGraceExpired ? 20_000 : 5_000,
    );

    return () => window.clearInterval(interval);
  }, [cameFromCheckout, checkoutGraceExpired, enrollment]);

  useEffect(() => {
    if (!user || !courseId || !hasBackendConfig) {
      return;
    }

    return subscribeToEnrollment(
      user.uid,
      courseId,
      (nextEnrollment) => {
        setEnrollmentState({
          enrollment: nextEnrollment,
          key: courseId,
          ready: true,
        });
      },
      () => {
        setError("learnWave2.workspace.enrollmentError");
        setEnrollmentState({
          enrollment: null,
          key: courseId,
          ready: true,
        });
      },
    );
  }, [courseId, enrollmentRecheck, hasBackendConfig, user]);

  useEffect(() => {
    if (!enrollment || !canOpenEnrollment(enrollment.status) || !courseId) {
      return;
    }

    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setCourseState({
          course: nextCourse,
          key: courseId,
          ready: true,
        });
      },
      () => {
        setError("learnWave2.workspace.courseError");
        setCourseState({
          course: null,
          key: courseId,
          ready: true,
        });
      },
    );
  }, [courseId, enrollment]);

  if (!courseId) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.notSelected")}
        detail={t("learnWave2.workspace.notSelectedDetail")}
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.disconnected")}
        detail={t("learnWave2.workspace.disconnectedDetail")}
      />
    );
  }

  if (isLoadingEnrollment || isLoadingCourse) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.loading")}
        detail={t("learnWave2.workspace.loadingDetail")}
      />
    );
  }

  if (error) {
    return <CreatorWorkspaceState title={t("learnWave2.workspace.unavailable")} detail={t(error)} />;
  }

  if (!enrollment) {
    if (cameFromCheckout) {
      return checkoutGraceExpired ? (
        <CreatorWorkspaceState
          title={t("learnWave2.workspace.delayed")}
          detail={t("learnWave2.workspace.delayedDetail")}
        />
      ) : (
        <CreatorWorkspaceState
          title={t("learnWave2.workspace.received")}
          detail={t("learnWave2.workspace.receivedDetail")}
        />
      );
    }

    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.required")}
        detail={t("learnWave2.workspace.requiredDetail")}
      />
    );
  }

  if (!canOpenCourse) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.inactive")}
        detail={t("learnWave2.workspace.inactiveDetail").replace("{status}", () => t(`learnWave2.enrollmentStatus.${enrollment.status}`))}
      />
    );
  }

  if (!course) {
    return (
      <CreatorWorkspaceState
        title={t("learnWave2.workspace.missing")}
        detail={t("learnWave2.workspace.missingDetail")}
      />
    );
  }

  return (
    <>
      {/* COURSE_VIEWED for teacher-published courses. It fires here rather
          than in the route because the URL segment is ambiguous — sometimes a
          DB id, sometimes an enrollment slug — and mixing both into course_id
          would break every aggregation. `course.id` is the only reliable key.
          slug is omitted: TeacherCourse has no slug field (the converter just
          aliases slug: course.id), and CourseViewedProps makes it optional. */}
      <CourseViewedTracker course_id={course.id} source="direct" />
      <EnrolledCourseWorkspace
        course={teacherCourseToLearningCourse(course)}
        enableFirestoreAssets
        whitelabel={whitelabel}
        tab={tab}
        openPostId={openPostId}
      />
    </>
  );
}

function CreatorWorkspaceState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("learnWave2.workspace.eyebrow")}
      </p>
      {/* h1: nestes estados esta seção É a página inteira. O caminho feliz
          delega ao EnrolledCourseWorkspace, que traz o MembersAreaHero com o
          h1 — mas carregando, com erro, sem matrícula e, o que mais importa,
          na tela de "pagamento recebido", nada disso renderiza. O comprador
          que acabou de pagar ficava num documento cujo único cabeçalho era um
          h3 solto, sem título de página nenhum. */}
      <h1 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/learn" className="button-solid px-4 py-2.5 text-sm">
          {t("learnWave2.workspace.back")}
        </Link>
        <Link href="/courses" className="button-outline px-4 py-2.5 text-sm">
          {t("learnWave2.workspace.marketplace")}
        </Link>
      </div>
    </section>
  );
}
