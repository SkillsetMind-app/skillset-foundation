"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Circle,
  FileDown,
  Layers3,
  Plus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { TeacherOverviewMetrics } from "@/components/teacher/teacher-overview-metrics";
import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import { StudioStorefrontCard } from "@/components/teacher/studio-storefront-card";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import { EmptyState, ProgressBar, buttonClasses } from "@/components/ui";
import { DrawnCheck, MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SpotArt } from "@/components/ui/spot-art";
import { activationFeeUsd } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { logSubscriptionError } from "@/lib/data/subscription-error";

type ProductFilter = "all" | "draft" | "published" | "in_review" | "other";

// The "Next steps" block only enters when courses and gates arrive, ~0.6 s after the
// product list: on the phone "My products" dropped 632px in front of whoever was about to
// tap. The height the block had on the last visit (on this device, at this
// screen width) stays reserved while the data arrives.
const NEXT_STEPS_HEIGHT_KEY = "skillset.studio.nextStepsHeight.v1";
const EMPTY_SUBSCRIBE = () => () => {};

function readNextStepsHeight(userId: string): number {
  if (!userId) return 0;
  try {
    const saved = JSON.parse(window.localStorage.getItem(NEXT_STEPS_HEIGHT_KEY) ?? "null");
    if (saved?.uid !== userId || typeof saved.h !== "number" || typeof saved.w !== "number") return 0;
    // A different width (phone in landscape, resized window) breaks the text into
    // other lines: the saved height is no longer valid.
    return Math.abs(saved.w - window.innerWidth) <= 48 ? saved.h : 0;
  } catch {
    return 0;
  }
}

function saveNextStepsHeight(userId: string, height: number) {
  try {
    window.localStorage.setItem(
      NEXT_STEPS_HEIGHT_KEY,
      JSON.stringify({ uid: userId, w: window.innerWidth, h: height }),
    );
  } catch {
    // ponytail: storage blocked (private mode): the block just does not reserve the space.
  }
}

export function TeacherStudioDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  // The same gates the builder and Manage read: payouts, and verification
  // only when the platform requires it.
  const { account, loaded: gatesLoaded, verificationStatus } = usePublishGates(user);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  // A read that failed must not look like zero revenue: the tiles say
  // "Unavailable" (like Earnings), and while loading they stay on the skeleton.
  const [ordersState, setOrdersState] = useState<"loading" | "ready" | "error">("loading");
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";
  // The one-time activation fee comes from the same hook (the SAME predicate the
  // server applies on publish, fails open): one read per visit.
  const activationBlocked = account.activationBlocked ?? false;

  const coursesSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const ordersSubscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesFailed(false);
        setCoursesLoaded(true);
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.courses")(error);
        setCoursesFailed(true);
        setCoursesLoaded(true);
      }
    );
    coursesSubscription.current = current;
    return () => {
      coursesSubscription.current = null;
      current();
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Courses, orders and profile were read 3x, 3x and 2x per /teach: each block
    // of the Home opened its own read. Now the Home reads once and passes it down.
    const current = subscribeToTeacherOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setOrdersState("ready");
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.orders")(error);
        setOrdersState("error");
      }
    );
    ordersSubscription.current = current;
    return () => {
      ordersSubscription.current = null;
      current();
    };
  }, [user]);

  // A read that failed gets "Try again" (before, the way out was reloading the
  // page): it re-reads through the same channel, only what failed, and meanwhile the
  // block goes back to the skeleton.
  const readFailed = coursesFailed || ordersState === "error";
  function retryLoad() {
    if (coursesFailed) {
      setCoursesFailed(false);
      setCoursesLoaded(false);
      void coursesSubscription.current?.reload();
    }
    if (ordersState === "error") {
      setOrdersState("loading");
      void ordersSubscription.current?.reload();
    }
  }

  // "inactive" is a course that was once live (the admin took it down): it has already been published.
  const launched = courses.some(
    (course) => course.status === "published" || course.status === "inactive"
  );
  // Archived is also "inactive": it left sale and does not charge Stripe.
  const needsStripe = courses.some(
    (course) => course.status !== "inactive" && sellsPaid(course)
  );
  // First visit, no product: the list's empty state holds the ONLY strong button.
  // Filters, formats and the solid "New product" competed with it.
  // A read that failed is not "no product": no invitation to create a
  // repeated product under the error.
  const noProducts = coursesLoaded && courses.length === 0 && !coursesFailed;
  const greetingKey = !coursesLoaded
    ? "hello"
    : courses.length > 0 || coursesFailed
      ? "welcomeBack"
      : "welcome";

  return (
    // grid-cols-1 = minmax(0, 1fr): without it the column grew to the width of the
    // "My products" filters (they scroll inside) and at 375px the whole screen
    // went 35px past the edge, cutting the title, text and the "67%".
    <div className="grid grid-cols-1 gap-8">
      {user ? (
        <TeacherWelcomeTour
          key={user.uid}
          userId={user.uid}
          firstName={firstName}
          hasProducts={courses.length > 0}
        />
      ) : null}
      {/* One headline per screen. The page's eye was "Producer home" in
          small caps SUPPORTED by "Welcome back, {name}" right below: two
          titles competing for the same reading line, and the top one did not even
          name the screen ("Home" is already in the bar and in the top trail). */}
      {/* "Welcome back" only for those who already have a product: on the 1st visit the sentence
          was false. While the list loads, "Welcome" applies, which never
          lies. Before the list arrives we cannot know which of the two is
          true: "Hello" applies, which claims nothing. If the courses
          subscription fails, the earlier "Welcome back" stays. */}
      {/* The same header as the sibling screens (it was 36px with no serif, only here).
          Only "New product": the "Storefront" here led to the same editor as the
          "Edit storefront" of the storefront card, right below. */}
      <PlatformPageHeader
        title={
          firstName
            ? t(`teach.dashboard.${greetingKey}Named`).replace("{name}", () => firstName)
            : t(`teach.dashboard.${greetingKey}`)
        }
        description={t("creatorPanel.home.description")}
        actions={
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className={`${noProducts ? "button-outline" : "button-solid"} px-4 text-sm`}
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            {t("creatorPanel.newProduct")}
          </Link>
        }
      />

      {readFailed ? (
        <div className="grid gap-3">
          <InlineAlert tone="error">{t("teach.dashboard.loadError")}</InlineAlert>
          <button type="button" onClick={retryLoad} className="button-outline justify-self-start px-4 text-sm">
            {t("appErrors.retry")}
          </button>
        </div>
      ) : null}

      <StudioNextSteps
        userId={user?.uid ?? ""}
        courses={courses}
        ready={coursesLoaded && gatesLoaded}
        account={account}
        verificationStatus={verificationStatus}
        needsStripe={needsStripe}
        activationBlocked={activationBlocked}
        launched={launched}
      />

      <StudioProductsSection courses={courses} coursesLoaded={coursesLoaded} coursesFailed={coursesFailed} />

      <div className="grid gap-8 lg:grid-cols-2">
        <StudioRecentActivity courses={courses} orders={orders} />
        {user ? (
          <StudioStorefrontCard
            uid={user.uid}
            courses={courses}
            coursesLoaded={coursesLoaded}
            verificationStatus={verificationStatus}
          />
        ) : null}
      </div>

      {/* The formats are shortcuts for those who already have a product; the first product
          already chooses the format on the creation screen. */}
      {courses.length > 0 ? <StudioSellFormatsSection /> : null}

      {/* The milestones ("Creator milestones") repeated the same steps as the list
          above, and the "Finish your Stripe setup" card of the attention list
          repeated the Stripe step: the pending item now shows up only once. */}
      <TeacherOverviewMetrics
        courses={courses}
        orders={orders}
        isLoading={!coursesLoaded || ordersState === "loading"}
        ordersFailed={ordersState === "error"}
      />
      {launched ? <TeacherStudioInsights courses={courses} orders={orders} /> : null}
    </div>
  );
}

function StudioNextSteps({
  userId,
  courses,
  ready,
  account,
  verificationStatus,
  needsStripe,
  activationBlocked,
  launched,
}: {
  userId: string;
  courses: TeacherCourse[];
  // Courses and gates loaded. Before that the list can still gain or lose
  // steps (required verification, plan, Stripe): the block does not show up.
  ready: boolean;
  account: CourseReadinessAccount;
  verificationStatus: string | null;
  needsStripe: boolean;
  activationBlocked: boolean;
  launched: boolean;
}) {
  const { t } = useTranslation();
  // The steps are the real publish gates (getCourseReadiness via
  // usePublishGates): Stripe only for a paid product, verification only when the
  // platform requires it. Before, step 2 demanded APPROVED verification from
  // everyone, there was no publish step and the bar stopped at 67%.
  const steps = [
    {
      id: "create",
      label: t("creatorPanel.home.steps.create"),
      detail: t("creatorPanel.home.steps.createDetail"),
      href: "/teach/builder?newCourse=1&format=course",
      done: courses.length > 0,
      action: t("creatorPanel.createProduct"),
    },
    // The plan comes AFTER creating: the free trial is only required to publish, and
    // asking for the card from someone who has not built anything yet was the house's first step.
    // The button opens the plan cards (/account/plans); before it opened the page
    // of learner receipts (/account/billing), three clicks from the trial.
    ...(account.planRequired
      ? [{
          id: "plan",
          label: t("creatorEditor.readiness.items.plan.label"),
          detail: t("creatorEditor.readiness.items.plan.hint"),
          href: "/account/plans",
          done: false,
          action: t("billingCheckout.seePlans"),
        }]
      : []),
    ...(needsStripe
      ? [
          {
            id: "payouts",
            label: t("platform.banner.connectPayoutsCta"),
            // The sentence from the old fixed yellow strip at the top of /teach: the
            // buyer pays INTO the teacher's account.
            detail: t("platform.banner.connectPayouts"),
            href: "/account/payments#stripe-connect",
            done: account.payoutsReady,
            action: t("platform.banner.connectPayoutsCta"),
          },
        ]
      : []),
    ...(account.verificationRequired
      ? [
          {
            id: "verification",
            label: t("creatorEditor.readiness.items.verification.label"),
            detail: t("creatorEditor.readiness.items.verification.hint"),
            href: "/teach/verification",
            done: account.verificationApproved,
            // Under review there is no "starting" again; an adjustment request or rejection
            // is resolved by editing the request.
            action: t(
              verificationStatus === "pending"
                ? "professionalBadge.inReview"
                : verificationStatus === "needs_changes" || verificationStatus === "rejected"
                  ? "professionalBadge.edit"
                  : "creatorPanel.home.steps.verifyAction"
            ),
          },
        ]
      : []),
    {
      id: "publish",
      label: t("creatorPanel.home.steps.publish"),
      // With the fee required and unpaid, the server refuses publish without it: the
      // Home warns beforehand, with the same "Activate and publish" as the builder.
      detail: activationBlocked
        ? t("creatorPanel.home.steps.publishActivateDetail").replace(
            "{amount}",
            () => String(activationFeeUsd)
          )
        : t("creatorPanel.home.steps.publishDetail"),
      href: courses[0]
        ? `/teach/builder?courseId=${encodeURIComponent(courses[0].id)}&tab=review`
        : "/teach/builder?newCourse=1&format=course",
      done: launched,
      action: t(
        activationBlocked
          ? "creatorPanel.home.steps.publishActivateAction"
          : "creatorPanel.home.steps.publishAction"
      ),
    },
  ];
  const completeCount = steps.filter((step) => step.done).length;
  const progress = Math.round((completeCount / steps.length) * 100);
  const progressText = t("creatorPanel.home.nextSteps.progress")
    .replace("{done}", () => String(completeCount))
    .replace("{total}", () => String(steps.length));
  // The open step gets the highlight and the button, in its own place. Before, a
  // side panel ("Recommended now") repeated its title and sentence, and with
  // everything done it recommended "Publish your product" to someone who had already published.
  const openStep = steps.find((step) => !step.done);
  // The check draws itself and the badge grows only on the step that became ready with the
  // Home open; whoever arrives with everything ready sees everything still.
  const justDone = useJustDone(steps.filter((step) => step.done).map((step) => step.id), ready);
  const visible = ready && (Boolean(openStep) || justDone.size > 0);
  const reserved = useSyncExternalStore(EMPTY_SUBSCRIBE, () => readNextStepsHeight(userId), () => 0);
  const sectionRef = useRef<HTMLElement>(null);
  // Everything that changes the block's height: steps that enter or leave (the plan one
  // is read again when the window gets focus), done ones, and texts (the activation
  // fee arrives later and lengthens the publish sentence).
  const hasOpenStep = Boolean(openStep);
  const layoutKey = steps.map((step) => `${step.id}:${step.done}:${step.detail}:${step.action}`).join("|");
  // Saves today's height for the next visit. With no open step, 0: the
  // last step done with the Home open leaves the block on screen, but on the next
  // visit it no longer shows up, and the reserved place would vanish in a jump.
  useEffect(() => {
    if (ready && userId) saveNextStepsHeight(userId, hasOpenStep ? (sectionRef.current?.offsetHeight ?? 0) : 0);
  }, [ready, userId, visible, hasOpenStep, layoutKey]);

  // Before courses and gates arrive the empty list opened "Create a product" and,
  // for someone with everything ready, the block appeared and vanished on every visit: nothing
  // until `ready`. Everything ready on opening the Home: the block leaves the screen. If the last
  // step became ready with the Home open, it stays until the next visit.
  if (!ready) {
    return reserved > 0 ? (
      <div
        aria-hidden="true"
        data-reserved="next-steps"
        className="animate-pulse overflow-hidden border-y border-[var(--color-line)] bg-white px-4 py-5 sm:px-5"
        style={{ height: reserved }}
      >
        <div className="h-3 w-24 rounded-sm bg-[var(--color-surface-strong)]" />
        <div className="mt-2 h-5 w-48 max-w-full rounded-sm bg-[var(--color-surface-strong)]" />
        <div className="mt-6 h-2 rounded-full bg-[var(--color-surface-strong)]" />
      </div>
    ) : null;
  }
  if (!visible) {
    return null;
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="next-steps-title"
      className="border-y border-[var(--color-line)] bg-white"
    >
      <div>
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
            {/* aria-hidden: the bar below says the "2 of 3" (name) and the
                percentage (value); without this the screen reader read it twice. */}
            <div aria-hidden="true" className="text-right">
              <p className="text-2xl font-semibold tabular-nums text-[var(--color-primary)]">
                {`${progress}%`}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]">{progressText}</p>
            </div>
          </div>

          {/* The shared bar, the same as the learner's: progress and achievement.
              The "2 of 3" right above is the number that goes with the bar. */}
          <div className="mt-4 flex items-center gap-2">
            <ProgressBar value={progress} label={progressText} className="flex-1" />
            {/* The milestone: the bar reached the end. */}
            {progress === 100 ? <MilestoneSeal animate={justDone.size > 0} /> : null}
          </div>

          <ol
            className="mt-4 grid gap-2 sm:auto-cols-fr sm:grid-flow-col"
            aria-label={t("creatorPanel.home.nextSteps.listLabel")}
          >
            {steps.map((step, index) => {
              const current = step.id === openStep?.id;
              const rule = current ? "border-[var(--color-primary)]" : "border-[var(--color-line)]";
              const body = (
                <>
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {step.done ? (
                      <DrawnCheck size={15} animate={justDone.has(step.id)} />
                    ) : (
                      <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
                    )}
                    0{index + 1}
                  </span>
                  <strong className="mt-2 text-sm text-[var(--color-ink)]">{step.label}</strong>
                  <small className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                    {step.detail}
                  </small>
                </>
              );

              return (
                <li key={step.id} aria-current={current ? "step" : undefined}>
                  {/* Creating the 1st product gets no button here: the product list's empty state,
                      right below, is already the screen's strong button. */}
                  {/* Line on top, not on the left: a colored border on the side is
                      the card that the design pattern forbids. */}
                  {current && step.id !== "create" ? (
                    <div className={`flex h-full min-h-24 flex-col items-start border-t-2 px-3 pb-2 pt-3 ${rule}`}>
                      {body}
                      <Link href={step.href} className="button-solid mt-3 max-w-full px-4 text-sm">
                        {step.action}
                        <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
                      </Link>
                    </div>
                  ) : (
                    <Link
                      href={step.href}
                      className={`flex h-full min-h-24 flex-col border-t-2 px-3 pb-2 pt-3 transition-colors hover:border-[var(--color-primary)] ${rule}`}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

function StudioProductsSection({
  courses,
  coursesLoaded,
  coursesFailed,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  coursesFailed: boolean;
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
        {courses.length > 0 ? (
          <Link href="/teach/builder" className="button-outline px-4 text-sm">
            {t("creatorPanel.home.products.showAll")}
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        ) : null}
      </div>

      {/* Five filters over an empty list only made noise on the 1st visit. */}
      {/* A filter, not section tabs: the house segmented selector (the same as the
          period), in place of the underlined bar made by hand only here. */}
      {courses.length > 0 ? (
        <div className="mt-4">
          <PeriodTabs
            options={filters.map((item) => item.id)}
            value={filter}
            onChange={setFilter}
            label={t("creatorPanel.home.products.filtersLabel")}
            renderLabel={(id) => filters.find((item) => item.id === id)?.label ?? id}
          />
        </div>
      ) : null}

      {!coursesLoaded ? (
        // The skeleton has the shape of the card to come (16:9 cover, type, title,
        // lessons line): it was a 128px block for a ~260px card, and the
        // section doubled in height when the products arrived.
        <div role="status" className="mt-3">
          <span className="sr-only">{t("creatorPanel.products.loading")}</span>
          <div aria-hidden="true" className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="min-h-36 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                <div className="aspect-video rounded-md bg-[var(--color-surface-strong)]" />
                <div className="mt-3 h-3 w-20 rounded-sm bg-[var(--color-surface-strong)]" />
                <div className="mt-3 h-4 w-3/4 rounded-sm bg-[var(--color-surface-strong)]" />
                <div className="mt-2 h-3 w-1/2 rounded-sm bg-[var(--color-surface-strong)]" />
              </div>
            ))}
          </div>
        </div>
      ) : courses.length === 0 && coursesFailed ? (
        // The read failed: the error with "Try again" above is enough (as in Media).
        null
      ) : courses.length === 0 ? (
        // No product yet: the first-product scene is the only brass button
        // on the Home (the milestone), in place of the one-sentence dashed strip.
        <EmptyState
          as="h3"
          art={<SpotArt scene="firstProduct" />}
          title={t("creatorPanel.home.products.firstTitle")}
          action={
            <Link
              href="/teach/builder?newCourse=1&format=course"
              className={buttonClasses({ variant: "accent", size: "lg" })}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              {t("creatorPanel.home.products.firstCta")}
            </Link>
          }
          className="mt-3"
        />
      ) : filtered.length === 0 ? (
        // Just the sentence, in the house's empty box (the same as the "first product"
        // right above): the header's "New product" already creates, and a second
        // solid button here competed with it.
        <EmptyState as="h3" title={t("creatorPanel.home.products.empty")} className="mt-3" />
      ) : (
        // motion-stagger: the cards rise in a staircase (40ms each) when the
        // data arrives; the list only mounts after the skeleton.
        <ul className="motion-stagger mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {filtered.slice(0, 4).map((course, index) => (
            <li key={course.id} style={{ "--i": index } as CSSProperties}>
              <Link
                href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
                className="motion-hover-lift flex h-full min-h-36 flex-col rounded-lg border border-[var(--color-line)] bg-white p-4 transition hover:border-[var(--color-primary-light)] hover:shadow-sm"
              >
                {/* The same 16:9 thumbnail as the product list (/teach/builder):
                    the cover when it exists, the same icon when it does not. Without the
                    cover the card was just text and the teacher did not recognize their
                    own product. */}
                <div className="mb-3 grid aspect-video w-full place-items-center overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
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
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {t(productTypeKey(course))}
                  </span>
                  {/* It was gold text for every status: "Published" and "Needs
                      changes" came out the same. The chip gives each its own color. */}
                  <StatusChip status={course.status || "draft"} />
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
  // The same four types as the creation screen, with the same texts. Free,
  // subscription and guided program stopped being a type (they are price and pace).
  const formats: Array<{
    title: string;
    detail: string;
    href: string;
    icon: LucideIcon;
  }> = [
    { id: "course", icon: BookOpenCheck },
    { id: "community", icon: UsersRound },
    { id: "live_event", icon: CalendarDays },
    { id: "ebook", icon: FileDown },
  ].map(({ id, icon }) => ({
    title: t(`courseCreation.types.${id}.label`),
    detail: t(`courseCreation.types.${id}.help`),
    href: `/teach/builder?newCourse=1&format=${id}`,
    icon,
  }));

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
      {/* Four columns only at xl, like the cards and milestones on this screen: at
          lg (1024px) with the sidebar open each format ended up ~176px. */}
      <ul className="mt-5 grid gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4">
        {formats.map((format) => {
          const Icon = format.icon;

          return (
            <li key={format.title} className="bg-white">
              <Link
                href={format.href}
                className="group flex h-full min-h-44 flex-col p-4 hover:bg-[var(--color-surface-soft)]"
              >
                <span className="grid size-9 place-items-center rounded-md border border-[var(--color-line)] text-[var(--color-primary)]">
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

// The reading of getCourseReadiness: with no paymentType recorded, price 0 is Free.
// Outside Free, you only publish with a price, and a price requires Stripe payouts.
function sellsPaid(course: TeacherCourse) {
  return (course.paymentType ?? (course.priceAmountMinor === 0 ? "free" : "one_time")) !== "free";
}

// Data code -> dictionary key; the card shares the format names above.
// The card badge is the type recorded at creation (courses.product_format).
// Free and subscription are price, not type.
function productTypeKey(course: TeacherCourse) {
  return `courseCreation.types.${course.productFormat ?? "course"}.label`;
}
