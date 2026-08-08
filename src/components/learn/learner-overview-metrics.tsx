"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Certificate } from "@/domain/certificate";
import type { CourseEvent } from "@/domain/course-event";
import { canContinueEnrollment, type Enrollment } from "@/domain/enrollment";
import { subscribeToUserCertificates } from "@/lib/data/certificates";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";
import { logSubscriptionError } from "@/lib/data/subscription-error";

const weekMillis = 7 * 24 * 60 * 60 * 1000;

export function LearnerOverviewMetrics() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [eventBuckets, setEventBuckets] = useState<
    Record<string, CourseEvent[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      return;
    }

    try {
      return subscribeToUserEnrollments(
        user.uid,
        (nextEnrollments) => {
          setEnrollments(nextEnrollments);
          setIsLoading(false);
        },
        () => setIsLoading(false),
      );
    } catch (error) {
      // Data layer unavailable (e.g. Supabase client not configured): degrade to an
      // empty state instead of crashing the learner dashboard. Deliberate
      // one-shot recovery reset.
      console.warn(
        "LearnerOverviewMetrics: enrollments subscription unavailable",
        error,
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    try {
      return subscribeToUserCertificates(
        user.uid,
        setCertificates,
        logSubscriptionError("LearnerOverviewMetrics.certificates"),
      );
    } catch (error) {
      // Non-blocking metric: degrade silently in the UI but keep the failure
      // visible in logs.
      console.warn(
        "LearnerOverviewMetrics: certificates subscription unavailable",
        error,
      );
    }
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
            setEventBuckets((current) => ({
              ...current,
              [courseSlug]: events,
            })),
          logSubscriptionError(`LearnerOverviewMetrics.courseEvents[${courseSlug}]`),
        ),
      );

      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    } catch (error) {
      // Non-blocking metric: degrade silently in the UI but keep the failure
      // visible in logs.
      console.warn(
        "LearnerOverviewMetrics: course events subscription unavailable",
        error,
      );
    }
  }, [enrollments]);

  const inProgress = enrollments.filter((enrollment) =>
    canContinueEnrollment(enrollment.status),
  ).length;

  const liveThisWeek = useMemo(() => {
    // Display-only metric recomputed whenever event data changes; reading the
    // wall clock here is intentional and any staleness is harmless.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return Object.values(eventBuckets)
      .flat()
      .filter((event) => {
        const startsAt = Date.parse(event.startsAt);
        return (
          Number.isFinite(startsAt) &&
          startsAt >= now &&
          startsAt <= now + weekMillis
        );
      }).length;
  }, [eventBuckets]);

  const credentials = certificates.filter(
    (certificate) => certificate.status === "issued",
  ).length;

  const cards = [
    {
      label: t("learn.metrics.coursesInProgress"),
      value: String(inProgress),
      hint: t("learn.metrics.coursesInProgressHint"),
    },
    {
      label: t("learn.metrics.liveThisWeek"),
      value: String(liveThisWeek),
      hint: t("learn.metrics.liveThisWeekHint"),
    },
    {
      label: t("learn.metrics.credentialsIssued"),
      value: String(credentials),
      hint: t("learn.metrics.credentialsIssuedHint"),
    },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-[14px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            {card.label}
          </p>
          {isLoading ? (
            <div className="mt-3 h-8 w-16 animate-pulse rounded bg-[var(--color-surface-strong)]" />
          ) : (
            <p className="mt-2 text-3xl font-bold text-[var(--color-primary)]">
              {card.value}
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            {card.hint}
          </p>
        </div>
      ))}
    </section>
  );
}
