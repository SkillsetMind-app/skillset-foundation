"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Repeat } from "lucide-react";

import type { CourseSubscription } from "@/domain/course-subscription";
import { subscribeToCourseSubscription } from "@/lib/data/course-subscriptions";
import { setCourseSubscriptionCancellation } from "@/lib/payments/course-subscription";

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

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
  const [subscription, setSubscription] = useState<CourseSubscription | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // Reset on subscriptionId change is handled by the parent's `key` prop
  // (it remounts this card), so the effect only subscribes — no synchronous
  // setState in the effect body (avoids cascading renders).
  useEffect(() => {
    return subscribeToCourseSubscription(
      subscriptionId,
      (next) => {
        setSubscription(next);
        setReady(true);
      },
      () => {
        setError("We could not load your subscription details.");
        setReady(true);
      },
    );
  }, [subscriptionId]);

  async function handleChange(resume: boolean) {
    setPending(true);
    setError("");

    try {
      // The immediate mirror write + the customer.subscription.updated webhook
      // both refresh the live subscription, so the card updates on its own.
      await setCourseSubscriptionCancellation(courseId, resume);
    } catch {
      setError(
        resume
          ? "We could not resume your subscription. Please try again."
          : "We could not cancel your subscription. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const status = subscription?.status ?? "";
  const cancelScheduled = Boolean(subscription?.cancelAtPeriodEnd);
  const periodEnd = formatDate(subscription?.currentPeriodEnd);
  const pastDue = Boolean(subscription?.pastDue) || status === "past_due";
  const isYearly = subscription?.interval === "year";
  const intervalLabel = isYearly
    ? "Yearly"
    : subscription?.interval === "month"
      ? "Monthly"
      : "Recurring";

  return (
    <div className="member-sidebar-card">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
        Subscription
      </p>
      <div className="mt-2 flex items-center gap-2">
        {isYearly ? (
          <CalendarClock size={16} className="text-[var(--color-accent)]" aria-hidden />
        ) : (
          <Repeat size={16} className="text-[var(--color-accent)]" aria-hidden />
        )}
        <h4 className="text-lg font-semibold text-[var(--color-primary)]">
          {intervalLabel} access
        </h4>
      </div>

      {!ready ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Loading subscription...
        </p>
      ) : !subscription ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Your subscription details will appear here shortly.
        </p>
      ) : (
        <>
          {pastDue ? (
            <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent)]">
              Last payment failed. Update your card to keep access — we are
              retrying the charge.
            </p>
          ) : cancelScheduled ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              Cancellation scheduled. You keep access
              {periodEnd ? ` until ${periodEnd}` : " until the end of the current period"}
              , then it won&apos;t renew.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              Active{periodEnd ? ` — renews ${periodEnd}` : ""}.
            </p>
          )}

          {error ? (
            <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent)]">
              {error}
            </p>
          ) : null}

          {cancelScheduled ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => handleChange(true)}
              className="button-solid mt-4 w-full px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {pending ? "Working..." : "Resume subscription"}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => handleChange(false)}
              className="button-outline mt-4 w-full px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {pending ? "Working..." : "Cancel subscription"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
