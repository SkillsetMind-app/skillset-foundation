"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Repeat } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { CourseSubscription } from "@/domain/course-subscription";
import { subscribeToCourseSubscription } from "@/lib/data/course-subscriptions";
import { toDate } from "@/lib/format-date";
import { setCourseSubscriptionCancellation } from "@/lib/payments/course-subscription";

const copy = "learn.classroom.subscription";

/**
 * Learner-facing subscription management for a course bought on a recurring
 * plan. Live-reads the courseSubscriptions mirror (own-read rule) so status,
 * renewal date, and cancellation state reflect the Stripe webhook in real time;
 * cancel/resume call the cancelCourseSubscription function (cancel at period
 * end — access continues through the paid period).
 */
export function CourseSubscriptionCard({
  courseId,
  subscriptionId,
}: {
  courseId: string;
  subscriptionId: string;
}) {
  const { locale, t } = useTranslation();
  const [subscription, setSubscription] = useState<CourseSubscription | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState(false);
  const [actionError, setActionError] = useState<"cancelError" | "undoError" | null>(null);

  // Reset on subscriptionId change is handled by the parent's `key` prop
  // (it remounts this card), so the effect only subscribes — no synchronous
  // setState in the effect body (avoids cascading renders).
  useEffect(() => {
    return subscribeToCourseSubscription(
      subscriptionId,
      (next) => {
        setSubscription(next);
        setReady(true);
        setReadError(false);
      },
      () => {
        setReadError(true);
        setReady(true);
      },
    );
  }, [subscriptionId]);

  async function handleChange(resume: boolean) {
    setPending(true);
    setActionError(null);

    try {
      // The immediate mirror write + the customer.subscription.updated webhook
      // both refresh the live subscription, so the card updates on its own.
      await setCourseSubscriptionCancellation(courseId, resume);
    } catch {
      setActionError(resume ? "undoError" : "cancelError");
    } finally {
      setPending(false);
    }
  }

  const status = subscription?.status ?? "";
  const cancelScheduled = Boolean(subscription?.cancelAtPeriodEnd);
  const periodDate = toDate(subscription?.currentPeriodEnd);
  const periodEnd = periodDate
    ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(periodDate)
    : t("creatorPanel.sales.datePending");
  const hasUpcomingCycle = status === "active" || status === "trialing";
  const cycleText = hasUpcomingCycle
    ? t(`${copy}.${cancelScheduled ? "scheduled" : "renews"}`).replace("{date}", () => periodEnd)
    : `${t("teach.subscriptions.periodEnd")} ${periodEnd}`;
  const pastDue = Boolean(subscription?.pastDue) || status === "past_due" || status === "unpaid";
  const isYearly = subscription?.interval === "year";
  const intervalLabel = isYearly
    ? t(`${copy}.yearlyAccess`)
    : subscription?.interval === "month"
      ? t(`${copy}.monthlyAccess`)
      : t(`${copy}.recurringAccess`);

  return (
    <div className="member-sidebar-card">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        {t(`${copy}.title`)}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {isYearly ? (
          <CalendarClock size={16} className="text-[var(--color-accent-fg)]" aria-hidden />
        ) : (
          <Repeat size={16} className="text-[var(--color-accent-fg)]" aria-hidden />
        )}
        <h4 className="text-lg font-semibold text-[var(--color-primary)]">
          {intervalLabel}
        </h4>
      </div>

      {[readError ? "loadError" : null, actionError].map((error) => error ? (
        <p
          key={error}
          role="alert"
          className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {t(`${copy}.${error}`)}
        </p>
      ) : null)}

      {!ready ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.loading`)}
        </p>
      ) : !subscription ? (
        !readError ? (
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.empty`)}
          </p>
        ) : null
      ) : (
        <>
          {pastDue ? (
            <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-fg)]">
              {t(`${copy}.paymentAttention`)}
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {cycleText}
          </p>

          {cancelScheduled ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => handleChange(true)}
              className="button-solid mt-4 w-full px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {pending ? t(`${copy}.working`) : t(`${copy}.undo`)}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => handleChange(false)}
              className="button-outline mt-4 w-full px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {pending ? t(`${copy}.working`) : t(`${copy}.cancel`)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
