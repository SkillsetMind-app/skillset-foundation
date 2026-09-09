"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  Check,
  Circle,
  Gift,
  Layers3,
  Plus,
  Repeat2,
  Route,
  Store,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { TeacherOverviewMetrics } from "@/components/teacher/teacher-overview-metrics";
import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import { StudioStorefrontCard } from "@/components/teacher/studio-storefront-card";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

type ProductFilter = "all" | "draft" | "published" | "in_review" | "other";

export function TeacherStudioDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("none");
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesLoaded(true);
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.courses")(error);
        setCoursesLoaded(true);
      }
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPayoutsReady(
          Boolean(profile?.stripeConnectChargesEnabled && profile?.stripeConnectPayoutsEnabled)
        );
        setVerificationStatus(profile?.creatorVerificationStatus ?? "none");
      },
      () => setPayoutsReady(false)
    );
  }, [user]);

  return (
    <div className="grid gap-8">
      {user ? <TeacherWelcomeTour key={user.uid} userId={user.uid} firstName={firstName} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--color-line)] pb-5">
        <div>
          {/* Uma manchete por tela. O olho da pagina era "Producer home" em
              versalete APOIADO por "Welcome back, {name}" logo abaixo: dois
              titulos disputando a mesma linha de leitura, e o de cima nem
              nomeava a tela ("Home" ja esta na barra e na trilha do topo). */}
          <h1 className="text-3xl font-semibold leading-tight text-[var(--color-primary)] sm:text-4xl">
            {firstName
              ? t("teach.dashboard.welcomeBackNamed").replace("{name}", () => firstName)
              : t("teach.dashboard.welcomeBack")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorPanel.home.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teach/storefront" className="button-outline px-4 text-sm">
            <Store aria-hidden="true" size={16} strokeWidth={1.9} />
            {t("creatorPanel.home.storefront")}
          </Link>
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className="button-solid px-4 text-sm"
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            {t("creatorPanel.newProduct")}
          </Link>
        </div>
      </header>

      <StudioNextSteps
        courses={courses}
        coursesLoaded={coursesLoaded}
        payoutsReady={payoutsReady}
        verificationStatus={verificationStatus}
      />

      <StudioProductsSection courses={courses} coursesLoaded={coursesLoaded} />

      <div className="grid gap-8 lg:grid-cols-2">
        <StudioRecentActivity courses={courses} />
        {user ? (
          <StudioStorefrontCard
            uid={user.uid}
            courses={courses}
            coursesLoaded={coursesLoaded}
          />
        ) : null}
      </div>

      <StudioSellFormatsSection />

      <StudioEvolution
        courses={courses}
        coursesLoaded={coursesLoaded}
        payoutsReady={payoutsReady}
        verificationStatus={verificationStatus}
      />

      <TeacherOverviewMetrics />
      <TeacherStudioInsights />
    </div>
  );
}

function StudioNextSteps({
  courses,
  coursesLoaded,
  payoutsReady,
  verificationStatus,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  payoutsReady: boolean;
  verificationStatus: string;
}) {
  const { t } = useTranslation();
  const hasPaidProduct = courses.some((course) => course.paymentType !== "free");
  const creatorDataComplete =
    verificationStatus === "approved" && (!hasPaidProduct || payoutsReady);
  const preparedProduct = courses.some(isProductPrepared);
  const steps = [
    {
      label: t("creatorPanel.home.steps.create"),
      detail: t("creatorPanel.home.steps.createDetail"),
      href: "/teach/builder?newCourse=1&format=course",
      done: courses.length > 0,
      action: t("creatorPanel.createProduct"),
    },
    {
      label: t("creatorPanel.home.steps.creatorData"),
      // Este passo herdou o texto da faixa amarela fixa que vivia no topo de
      // todo o /teach. A frase e a mesma, ja traduzida, e diz o que importa:
      // o comprador paga NA conta do professor, a plataforma nao segura o
      // dinheiro. Enquanto o Stripe nao conectar, o passo mostra isso; depois
      // volta a falar da verificacao, que e o que sobra.
      detail: payoutsReady
        ? t("creatorPanel.home.steps.creatorDataDetail")
        : t("platform.banner.connectPayouts"),
      href:
        verificationStatus === "approved"
          ? "/account/payments#stripe-connect"
          : "/teach/verification",
      done: creatorDataComplete,
      action: t("creatorPanel.home.steps.creatorDataAction"),
    },
    {
      label: t("creatorPanel.home.steps.prepare"),
      detail: t("creatorPanel.home.steps.prepareDetail"),
      href: courses[0]
        ? `/teach/courses/${encodeURIComponent(courses[0].id)}/manage`
        : "/teach/builder?newCourse=1&format=course",
      done: preparedProduct,
      action: t("creatorPanel.home.steps.prepareAction"),
    },
  ];
  const completeCount = steps.filter((step) => step.done).length;
  const progress = Math.round((completeCount / steps.length) * 100);
  const nextStep = steps.find((step) => !step.done) ?? steps[2];

  return (
    <section
      aria-labelledby="next-steps-title"
      className="border-y border-[var(--color-line)] bg-white"
    >
      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.65fr)]">
        <div className="px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {t("creatorPanel.home.nextSteps.eyebrow")}
              </p>
              <h2
                id="next-steps-title"
                className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
              >
                {t("creatorPanel.home.nextSteps.title")}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums text-[var(--color-primary)]">
                {coursesLoaded ? `${progress}%` : "-"}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]">
                {t("creatorPanel.home.nextSteps.progress")
                  .replace("{done}", () => String(completeCount))
                  .replace("{total}", () => String(steps.length))}
              </p>
            </div>
          </div>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-strong)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
              style={{ width: coursesLoaded ? `${progress}%` : "0%" }}
            />
          </div>

          <ol
            className="mt-4 grid gap-2 sm:grid-cols-3"
            aria-label={t("creatorPanel.home.nextSteps.listLabel")}
          >
            {steps.map((step, index) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="flex h-full min-h-24 flex-col border-l-2 border-[var(--color-line)] px-3 py-2 transition-colors hover:border-[var(--color-primary)]"
                >
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {step.done ? (
                      <Check aria-hidden="true" size={15} strokeWidth={2.4} />
                    ) : (
                      <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
                    )}
                    0{index + 1}
                  </span>
                  <strong className="mt-2 text-sm text-[var(--color-ink)]">{step.label}</strong>
                  <small className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                    {step.detail}
                  </small>
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <aside className="border-t border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            {t("creatorPanel.home.nextSteps.recommended")}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            {nextStep.label}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">{nextStep.detail}</p>
          <Link href={nextStep.href} className="button-solid mt-5 px-4 text-sm">
            {nextStep.action}
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        </aside>
      </div>
    </section>
  );
}

function StudioProductsSection({
  courses,
  coursesLoaded,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ProductFilter>("all");
  const filters: Array<{ id: ProductFilter; label: string }> = [
    { id: "all", label: t("creatorPanel.filters.all") },
    { id: "draft", label: t("creatorPanel.filters.drafts") },
    { id: "published", label: t("creatorPanel.home.products.filterLiveSales") },
    { id: "in_review", label: t("statusChip.in_review") },
    { id: "other", label: t("creatorPanel.filters.needsAttention") },
  ];
  const filtered = courses.filter((course) => {
    if (filter === "all") return true;
    if (filter === "draft") return course.status === "draft";
    if (filter === "published") return course.status === "published";
    if (filter === "in_review") return course.status === "in_review";
    return course.status === "needs_changes" || course.status === "inactive";
  });

  return (
    <section aria-labelledby="studio-products-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("platform.nav.courseBuilder")}
          </p>
          <h2
            id="studio-products-title"
            className="mt-1 text-2xl font-semibold text-[var(--color-primary)]"
          >
            {t("creatorPanel.home.products.title")}
          </h2>
        </div>
        <Link href="/teach/builder" className="button-outline px-4 text-sm">
          {t("creatorPanel.home.products.showAll")}
          <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
        </Link>
      </div>

      <div
        className="mt-4 flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
        role="tablist"
        aria-label={t("creatorPanel.home.products.filtersLabel")}
      >
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${
              filter === item.id
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!coursesLoaded ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse rounded-[8px] bg-[var(--color-surface-strong)]"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-3 border-y border-dashed border-[var(--color-line-strong)] px-5 py-10 text-center">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("creatorPanel.home.products.empty")}
          </p>
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className="button-solid mt-4 px-4 text-sm"
          >
            {t("creatorPanel.createProduct")}
          </Link>
        </div>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {filtered.slice(0, 4).map((course) => (
            <li key={course.id}>
              <Link
                href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
                className="flex h-full min-h-36 flex-col rounded-[8px] border border-[var(--color-line)] bg-white p-4 transition hover:border-[var(--color-primary-light)] hover:shadow-sm"
              >
                {/* A mesma miniatura 16:9 da lista de produtos (/teach/builder):
                    a capa quando existe, o mesmo icone quando nao existe. Sem a
                    capa o card era so texto e o professor nao reconhecia o
                    proprio produto. */}
                <div className="mb-3 grid aspect-video w-full place-items-center overflow-hidden rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  {course.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={course.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Layers3 aria-hidden="true" size={19} strokeWidth={1.7} />
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {t(productTypeKey(course))}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
                    {t(`statusChip.${course.status || "draft"}`)}
                  </span>
                </div>
                <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-ink)]">
                  {course.title || t("creatorPanel.untitledProduct")}
                </h3>
                <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                  {t(
                    course.lessonCount === 1
                      ? "publicCourses.lessonOne"
                      : "publicCourses.lessonMany"
                  ).replace("{count}", () => String(course.lessonCount))}
                  {course.communityEnabled ? ` · ${t("creatorPanel.communityOn")}` : ""}
                </p>
                <span className="mt-auto pt-4 text-xs font-semibold text-[var(--color-primary)]">
                  {t("creatorPanel.home.products.manage")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StudioSellFormatsSection() {
  const { t } = useTranslation();
  const formats: Array<{
    title: string;
    detail: string;
    href: string;
    icon: LucideIcon;
  }> = [
    {
      title: t("creatorPanel.home.formats.course"),
      detail: t("creatorPanel.home.formats.courseDetail"),
      href: "/teach/builder?newCourse=1&format=course",
      icon: BookOpenCheck,
    },
    {
      title: t("creatorPanel.home.formats.program"),
      detail: t("creatorPanel.home.formats.programDetail"),
      href: "/teach/builder?newCourse=1&format=program",
      icon: Route,
    },
    {
      title: t("creatorPanel.home.formats.subscription"),
      detail: t("creatorPanel.home.formats.subscriptionDetail"),
      href: "/teach/builder?newCourse=1&format=subscription",
      icon: Repeat2,
    },
    {
      title: t("creatorPanel.home.formats.community"),
      detail: t("creatorPanel.home.formats.communityDetail"),
      href: "/teach/builder?newCourse=1&format=community",
      icon: UsersRound,
    },
    {
      title: t("creatorPanel.home.formats.event"),
      detail: t("creatorPanel.home.formats.eventDetail"),
      href: "/teach/builder?newCourse=1&format=event",
      icon: CalendarDays,
    },
    {
      title: t("creatorPanel.home.formats.free"),
      detail: t("creatorPanel.home.formats.freeDetail"),
      href: "/teach/builder?newCourse=1&format=free",
      icon: Gift,
    },
  ];

  return (
    <section
      aria-labelledby="sell-formats-title"
      className="border-y border-[var(--color-line)] py-6"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        {t("creatorPanel.home.formats.eyebrow")}
      </p>
      <h2
        id="sell-formats-title"
        className="mt-1 text-2xl font-semibold text-[var(--color-primary)]"
      >
        {t("creatorPanel.home.formats.title")}
      </h2>
      <ul className="mt-5 grid gap-px overflow-hidden rounded-[8px] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
        {formats.map((format) => {
          const Icon = format.icon;

          return (
            <li key={format.title} className="bg-white">
              <Link
                href={format.href}
                className="group flex h-full min-h-44 flex-col p-4 hover:bg-[var(--color-surface-soft)]"
              >
                <span className="grid size-9 place-items-center rounded-[7px] border border-[var(--color-line)] text-[var(--color-primary)]">
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
                  {format.title}
                </h3>
                <p className="mt-2 flex-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                  {format.detail}
                </p>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-3 text-[var(--color-primary)] transition-transform group-hover:translate-x-1"
                  size={15}
                  strokeWidth={1.9}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StudioEvolution({
  courses,
  coursesLoaded,
  payoutsReady,
  verificationStatus,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  payoutsReady: boolean;
  verificationStatus: string;
}) {
  const { t } = useTranslation();
  const milestones = [
    {
      label: t("creatorPanel.home.milestones.firstProduct"),
      done: courses.length > 0,
      icon: BookOpenCheck,
    },
    {
      label: t("creatorPanel.home.milestones.verified"),
      done: verificationStatus === "approved",
      icon: BadgeCheck,
    },
    {
      label: t("creatorPanel.home.milestones.payouts"),
      done: payoutsReady,
      icon: Wallet,
    },
    {
      label: t("creatorPanel.home.milestones.firstLive"),
      done: courses.some((course) => course.status === "published"),
      icon: Store,
    },
  ];
  const achieved = milestones.filter((milestone) => milestone.done).length;

  return (
    <section aria-labelledby="evolution-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("creatorPanel.home.milestones.eyebrow")}
          </p>
          <h2
            id="evolution-title"
            className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
          >
            {t("creatorPanel.home.milestones.title")}
          </h2>
        </div>
        <span className="text-sm font-semibold tabular-nums text-[var(--color-ink-soft)]">
          {coursesLoaded ? `${achieved}/${milestones.length}` : "-"}
        </span>
      </div>
      <ol className="mt-4 grid border-y border-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4">
        {milestones.map((milestone, index) => {
          const Icon = milestone.icon;

          return (
            <li
              key={milestone.label}
              className="flex items-center gap-3 border-b border-[var(--color-line)] px-3 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"
            >
              <span
                className={`grid size-9 place-items-center rounded-full ${
                  milestone.done
                    ? "bg-[var(--color-primary)] text-white"
                    : "border border-[var(--color-line)] text-[var(--color-ink-muted)]"
                }`}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  {t("creatorPanel.home.milestones.item").replace("{number}", () => `0${index + 1}`)}
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                  {milestone.label}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function isProductPrepared(course: TeacherCourse) {
  const hasCommercialTerms = course.paymentType === "free" || (course.priceAmountMinor ?? 0) > 0;

  return (
    course.status === "published" ||
    (course.title.trim().length >= 3 &&
      course.summary.trim().length >= 20 &&
      course.category.trim().length >= 2 &&
      course.lessonCount > 0 &&
      hasCommercialTerms)
  );
}

// Data code -> dictionary key; the card shares the format names above.
function productTypeKey(course: TeacherCourse) {
  if (course.communityEnabled) return "creatorPanel.home.formats.community";
  if (course.paymentType === "subscription_monthly") return "creatorPanel.home.formats.subscription";
  if (course.paymentType === "subscription_yearly") return "creatorPanel.home.formats.subscription";
  if (course.paymentType === "free") return "creatorPanel.home.formats.free";
  return "creatorPanel.home.formats.course";
}
