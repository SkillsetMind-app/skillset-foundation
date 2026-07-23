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
      {user ? <TeacherWelcomeTour userId={user.uid} firstName={firstName} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--color-line)] pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
            Producer home
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)] sm:text-4xl">
            {firstName
              ? t("teach.dashboard.welcomeBackNamed").replace("{name}", firstName)
              : t("teach.dashboard.welcomeBack")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Continue setup, manage products, and follow the work that moves them toward publication
            and sales.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teach/storefront" className="button-outline min-h-10 px-4 text-sm">
            <Store aria-hidden="true" size={16} strokeWidth={1.9} />
            Storefront
          </Link>
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className="button-solid min-h-10 px-4 text-sm"
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            New product
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
  const hasPaidProduct = courses.some((course) => course.paymentType !== "free");
  const creatorDataComplete =
    verificationStatus === "approved" && (!hasPaidProduct || payoutsReady);
  const preparedProduct = courses.some(isProductPrepared);
  const steps = [
    {
      label: "Create a product",
      detail: "Choose the delivery and access model.",
      href: "/teach/builder?newCourse=1&format=course",
      done: courses.length > 0,
      action: "Create product",
    },
    {
      label: "Complete creator data",
      detail: "Finish professional verification and paid-product payouts.",
      href:
        verificationStatus === "approved"
          ? "/account/payments#stripe-connect"
          : "/teach/verification",
      done: creatorDataComplete,
      action: "Complete setup",
    },
    {
      label: "Prepare product to sell",
      detail: "Add content, pricing, members experience, and review the draft.",
      href: courses[0]
        ? `/teach/courses/${encodeURIComponent(courses[0].id)}/manage`
        : "/teach/builder?newCourse=1&format=course",
      done: preparedProduct,
      action: "Prepare product",
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
                Next steps
              </p>
              <h2
                id="next-steps-title"
                className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
              >
                Get ready for your first sale
              </h2>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums text-[var(--color-primary)]">
                {coursesLoaded ? `${progress}%` : "-"}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]">
                {completeCount} of {steps.length} complete
              </p>
            </div>
          </div>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-strong)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
              style={{ width: coursesLoaded ? `${progress}%` : "0%" }}
            />
          </div>

          <ol className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Creator next steps">
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
            Recommended now
          </p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            {nextStep.label}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">{nextStep.detail}</p>
          <Link href={nextStep.href} className="button-solid mt-5 min-h-10 px-4 text-sm">
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
  const [filter, setFilter] = useState<ProductFilter>("all");
  const filters: Array<{ id: ProductFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "draft", label: "Drafts" },
    { id: "published", label: "Live sales" },
    { id: "in_review", label: "In review" },
    { id: "other", label: "Needs attention" },
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
            My products
          </p>
          <h2
            id="studio-products-title"
            className="mt-1 text-2xl font-semibold text-[var(--color-primary)]"
          >
            Products in your workspace
          </h2>
        </div>
        <Link href="/teach/builder" className="button-outline min-h-10 px-4 text-sm">
          Show all
          <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
        </Link>
      </div>

      <div
        className="mt-4 flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
        role="tablist"
        aria-label="Product filters"
      >
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-10 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${
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
            No products in this view yet.
          </p>
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className="button-solid mt-4 min-h-10 px-4 text-sm"
          >
            Create product
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
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {productTypeLabel(course)}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
                    {(course.status || "draft").replaceAll("_", " ")}
                  </span>
                </div>
                <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-ink)]">
                  {course.title || "Untitled product"}
                </h3>
                <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                  {course.lessonCount} lessons
                  {course.communityEnabled ? " · Community on" : ""}
                </p>
                <span className="mt-auto pt-4 text-xs font-semibold text-[var(--color-primary)]">
                  Manage product
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
  const formats: Array<{
    title: string;
    detail: string;
    href: string;
    icon: LucideIcon;
  }> = [
    {
      title: "Online course",
      detail: "Video, text, downloads, certificates, and structured lessons.",
      href: "/teach/builder?newCourse=1&format=course",
      icon: BookOpenCheck,
    },
    {
      title: "Guided program",
      detail: "A sequenced pathway of learning, practice, and optional live touchpoints.",
      href: "/teach/builder?newCourse=1&format=program",
      icon: Route,
    },
    {
      title: "Subscription",
      detail: "Recurring access billed monthly or yearly.",
      href: "/teach/builder?newCourse=1&format=subscription",
      icon: Repeat2,
    },
    {
      title: "Community",
      detail: "A recurring members space for posts and practitioner-led exchange.",
      href: "/teach/builder?newCourse=1&format=community",
      icon: UsersRound,
    },
    {
      title: "Online event",
      detail: "Live workshops, cohorts, and scheduled group sessions.",
      href: "/teach/builder?newCourse=1&format=event",
      icon: CalendarDays,
    },
    {
      title: "Free program",
      detail: "Open enrollment without checkout or payment.",
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
        What do you want to sell?
      </p>
      <h2
        id="sell-formats-title"
        className="mt-1 text-2xl font-semibold text-[var(--color-primary)]"
      >
        Choose a product format
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
  const milestones = [
    {
      label: "First product",
      done: courses.length > 0,
      icon: BookOpenCheck,
    },
    {
      label: "Professional verified",
      done: verificationStatus === "approved",
      icon: BadgeCheck,
    },
    {
      label: "Payouts ready",
      done: payoutsReady,
      icon: Wallet,
    },
    {
      label: "First live product",
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
            My evolution
          </p>
          <h2
            id="evolution-title"
            className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
          >
            Creator milestones
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
                  Milestone 0{index + 1}
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

function productTypeLabel(course: TeacherCourse) {
  if (course.communityEnabled) return "Community";
  if (course.paymentType === "subscription_monthly") return "Subscription";
  if (course.paymentType === "subscription_yearly") return "Subscription";
  if (course.paymentType === "free") return "Free program";
  return "Online course";
}
