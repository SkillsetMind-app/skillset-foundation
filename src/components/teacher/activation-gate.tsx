"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { activationFeeUsd } from "@/data/plans";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { fetchCreatorActivationBlocked } from "@/lib/data/creator-verification";
import { hasAnyPermission } from "@/lib/permissions";

/**
 * The wall an unactivated creator hits on arrival in the studio.
 *
 * Until this existed the gate was reactive: a creator could browse every
 * /teach page and fill in the whole new-product form before the SQL trigger
 * refused the insert. This puts the refusal up front — the studio is visible
 * but not navigable until the one-time fee is paid.
 *
 * Non-dismissible on purpose: no close button, no backdrop click, no Escape.
 * useModalFocus leaves Escape to each dialog precisely because close semantics
 * differ; here there is no close, only "pay" or "leave the studio".
 *
 * It owns no checkout logic. The CTA hands off to /teach/activate, which owns
 * the Stripe session — same split as CourseUnlockModal handing off to
 * /courses/[id].
 */
export function ActivationGate() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // The layout mounts outside each page's ProtectedSurface, so repeat the
  // teacher check here — a signed-in learner who lands on /teach is already
  // refused by the page, and stacking this dialog on top of that refusal would
  // tell them to pay for a studio they were never asking for.
  const uid = user?.uid ?? null;
  const isTeacher = Boolean(
    user && hasAnyPermission({ roles: user.roles }, ["teacherStudio.access"]),
  );
  // /teach/activate is the checkout itself and /teach/activate/return is where
  // Stripe sends them back. Gating those traps the creator with no way to pay.
  const onActivationRoute = Boolean(pathname?.startsWith("/teach/activate"));

  useEffect(() => {
    if (!isTeacher || onActivationRoute) {
      setBlocked(false);
      return;
    }
    let active = true;
    fetchCreatorActivationBlocked()
      .then((value) => {
        if (active) setBlocked(value);
      })
      // ponytail: fail open. A network blip must not lock a creator who already
      // paid out of their own studio; publishing stays gated in SQL either way.
      // Tighten to a retry + blocking error state if this ever hides a real gate.
      .catch(() => {
        if (active) setBlocked(false);
      });
    return () => {
      active = false;
    };
  }, [isTeacher, onActivationRoute, uid]);

  useModalFocus(dialogRef, blocked);

  useEffect(() => {
    if (!blocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [blocked]);

  if (!blocked) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[80] flex items-stretch justify-center outline-none sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activation-gate-title"
    >
      <div
        className="absolute inset-0 bg-[rgba(15,39,68,0.72)] backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div className="relative z-[85] flex w-full max-w-md flex-col justify-center bg-white p-7 shadow-[0_30px_80px_rgba(15,39,68,0.32)] sm:rounded-[8px]">
        <h2
          id="activation-gate-title"
          className="text-xl font-semibold text-[var(--color-ink)]"
        >
          Activate your storefront
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          A one-time ${activationFeeUsd} fee unlocks the creator studio. It is
          charged once — never again, and never per course.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Your Free plan stays $0 per month after this. The fee opens the
          studio; the plan is what sets your commission per sale.
        </p>
        <Link
          href="/teach/activate"
          className="button-solid mt-6 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
        >
          Pay ${activationFeeUsd} and unlock the studio
        </Link>
        <Link
          href="/"
          className="mt-3 inline-flex w-full items-center justify-center text-xs text-[var(--color-ink-soft)] underline underline-offset-4"
        >
          Not now — leave the studio
        </Link>
      </div>
    </div>
  );
}
