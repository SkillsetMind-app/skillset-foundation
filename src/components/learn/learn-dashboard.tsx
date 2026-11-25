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
// What the dashboard highlights at the top: the three most recent lessons to resume,
// the three next lives and the three latest news items. The rest stays in the
// "My courses" grid, in the bell and in the schedule.
const TOP_ITEMS = 3;
// Search and filter in "My courses" only show above this: with few courses
// they just push the cards down.
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
  // A clock that ticks: the live stays on the dashboard while it happens, with "Happening now".
  const now = useNow();
  // The person's REAL courses. Without this the dashboard only saw the 6 demo
  // courses from `catalog.ts`, and a real enrollment never carries a demo
  // slug — `enrollments.ts:115` and the Stripe webhook write the course id
  // in `course_slug`. Result: `getCourseBySlug` returned undefined for
  // 100% of real purchases and the card fell back to the placeholder text
  // ("Private modules"), right on the first screen after paying.
  // Fetched by id (not the whole catalog) and passed down to the rows below.
  const [realCourses, setRealCourses] = useState<TeacherCourse[]>([]);
  // For which enrollment list the courses read has already come back (well or badly).
  const [coursesReadKey, setCoursesReadKey] = useState("");
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";

  // Matches the enrollment with the course, demo or real.
  //
  // `course_slug` holds sometimes the id and sometimes the slug, depending on the write path
  // (`enrollments.ts:69` writes the slug, `:115` and the webhook write the id) — that is why it
  // tests both forms instead of assuming one. A migration today already tolerates
  // this ambiguity in the database; the client has to tolerate it the same way, otherwise the
  // half that resolves access works and the half that shows the course does not.
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

  // Before: the first 200 published courses, whole, downloaded again on every
  // change to any course on the platform — and a course that was unpublished or outside
  // those 200 never showed up. Now only the person's courses, by id; the key
  // ignores the re-emission of the enrollments on every saved lesson.
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
          setCoursesReadKey(enrolledCourseKey);
        }
      })
      // A failure here must not take the dashboard down: without the real courses the card
      // goes back to the generic text, which is bad, but better than an error screen
      // over a purchase that exists.
      .catch(() => {
        if (!cancelled) setCoursesReadKey(enrolledCourseKey);
      });
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

  // "Try again" reads again through the same channel. Before, the only way out of the error was to
  // reload the page in the browser.
  function retryLoad() {
    setHasError(false);
    setIsLoading(true);
    void enrollmentsSubscription.current?.reload();
  }

  // Same source as the bell: what arrived new (a reply in the community,
  // a teacher's message, a certificate) only showed behind a click on the
  // bell; now the last three are up front, on the dashboard.
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
      // The schedule is a complement: without it the column says there is no live, and the
      // rest of the dashboard stays standing.
      console.warn("LearnDashboard: course events subscription unavailable", error);
    }
  }, [enrollments]);

  // The live stays until it ends (the common window from course-event.ts). Before, it
  // left the dashboard the minute it started, taking the "Join" with it. A deadline
  // leaves the moment it is overdue and is never "Happening now".
  const upcomingEvents = useMemo(() => {
    return Object.values(eventBuckets)
      .flat()
      .map((event) => ({
        event,
        startsAt: Date.parse(event.startsAt),
        state: getEventLiveState(event.startsAt, now, event.type),
      }))
      .filter(({ startsAt, state }) => Number.isFinite(startsAt) && state !== "over")
      .sort((left, right) => left.startsAt - right.startsAt)
      .map(({ event, startsAt, state }) => ({
        ...event,
        externalUrl: getSafeExternalUrl(event.externalUrl),
        isThisWeek: startsAt <= now + weekMillis,
        isLive: state === "live",
      }));
  }, [eventBuckets, now]);

  // The refund notice used to show on every visit. Now only while it is useful:
  // there is a paid purchase still inside the automatic refund rules. Only
  // "payment": a subscription generates no order, so there is nothing to refund in
  // Purchases. The window uses the enrollment's createdAt, not the order's paid_at
  // that the server uses: a re-granted access keeps the old createdAt and the
  // notice may be missing on an eligible repurchase. Billing remains the source of
  // truth; this is just a shortcut.
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
    // The skeleton has the shape of the loaded screen: the header row and the
    // "My courses" frame with three cards (16:10 cover, two lines and the
    // bar). Before, they were three loose boxes without the frame, and the page jumped
    // when the enrollments arrived.
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
          {/* "Try again" is the main action; explore and support stay beside it. */}
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
  // The three metric cards ("1 · 0 · 0") used to take a whole row before
  // the courses. They became a sentence under the greeting; the live only enters when it exists.
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

  // One destination per course, in both places where it shows up: the members
  // area, already on the lesson to resume — straight to the lesson, not the cover (?lesson= is
  // the lesson address in the classroom). Before, "My courses" opened the cover. A
  // completed course has nothing to resume: it opens on the cover, as before.
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

  // "Continue watching": the most recent first, like a video queue.
  // updatedAt is ISO coming from Postgres, so the text comparison sorts by
  // date; enrollments without a timestamp tie and fall back to progress.
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
  // With up to TOP_ITEMS courses, "My courses" right below already shows each one, with
  // the same destination: the resume queue would only repeat the same cards. It
  // comes back when there are more courses than fit in it.
  const showContinue = continueItems.length > 0 && enrollments.length > TOP_ITEMS;

  const latestNotifications = notifications.slice(0, TOP_ITEMS);
  const nextEvents = upcomingEvents.slice(0, TOP_ITEMS);

  const showCourseControls = enrollments.length > COURSE_CONTROLS_AFTER;
  const normalizedEnrollmentQuery = enrollmentQuery.toLowerCase().trim();
  // "In progress" gathers everything that is not completed, including a refunded
  // or expired enrollment: the chip says the status, and making it vanish would leave the
  // person not knowing why the course got stuck. Without the controls on screen, nothing is
  // filtered: the completed one shows together, instead of vanishing behind a tab.
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
        {/* The schedule left the sidebar (the learner has four fixed items):
            the path to it stays here, always, with or without a live scheduled —
            the lives that already passed are in /learn/events. */}
        <div className="flex flex-wrap items-center gap-2">
          <MemberAreaLinks
            courses={realCourses}
            enrollments={enrollments}
            coursesSettled={coursesReadKey === enrolledCourseKey}
          />
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
                      {/* Over the photo: the platform bar, inset and with rounded
                          corners (before, stuck to the edge and square). The number goes
                          as text at the end of the card, so the bar stays quiet. */}
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

      {/* With no live scheduled the column used to spend half a line saying so; now it
          disappears. An empty "What's new" disappears the same way: the "Nothing new yet."
          pushed "My courses" down on every visit. */}
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
                      {event.type === "deadline"
                        ? t("platform.events.dueBy").replace("{when}", () =>
                            formatEventDateTime(event.startsAt, locale, t("platform.events.datePending")),
                          )
                        : formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}
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
                      {t(event.type === "deadline" ? "platform.events.openLink" : "learn.dashboard.joinLive")}
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
              {/* A filter for a list, not section tabs: the house segmented
                  selector (aria-pressed), the same as in credentials. */}
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
              // The whole card opens the course (before: a full "Open" button per
              // card, six identical blue buttons with six courses). A refunded or
              // expired one does not open: it stays a stopped card with the status badge.
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
                    {/* Progress once only: the bar with the number beside it.
                        Before, "40% COMPLETE", the "ACTIVE" badge and the bar said
                        the same thing three times. */}
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <ProgressBar
                        value={percent}
                        label={t("learn.dashboard.percentComplete").replace("{percent}", String(percent))}
                        className="flex-1"
                      />
                      {/* The screen reader hears the value from the bar itself. */}
                      <span aria-hidden="true" className="text-xs font-bold tabular-nums text-[var(--color-primary)]">
                        {percent}%
                      </span>
                    </div>
                    {/* The badge only shows when there is something to say (completed,
                        refunded, expired); "active" is the normal state. */}
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
        {/* The "Request refund" left the card: it shared the row with "Open" and
            showed up every time the person came to study. The request already exists
            in Billing → Purchases, next to the purchase receipt — and the notice only
            shows while there is a purchase that can still be refunded. */}
        {hasRefundablePurchase ? (
          <p className="mt-5 text-xs leading-5 text-[var(--color-ink-soft)]">
            {t("learn.dashboard.refundsMoved")}{" "}
            <Link
              href="/account/billing?tab=purchases"
              className="font-semibold text-[var(--color-primary)]! hover:underline"
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
