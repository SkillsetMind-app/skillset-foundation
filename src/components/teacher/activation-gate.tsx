"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";
import { activationFeeUsd } from "@/data/plans";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { fetchCreatorActivationBlocked } from "@/lib/data/creator-verification";
import { hasAnyPermission } from "@/lib/permissions";

/**
 * The wall an unactivated creator hits on arrival in the studio.
 *
 * Studio children mount only after the shared predicate allows access. Network
 * failures keep a retryable gate, not a mounted studio behind an overlay.
 *
 * Non-dismissible on purpose: no close button, no backdrop click, no Escape.
 * useModalFocus leaves Escape to each dialog precisely because close semantics
 * differ; here there is no close, only "pay" or "leave the studio".
 *
 * It owns no checkout logic. The CTA hands off to /teach/activate, which owns
 * the Stripe session — same split as CourseUnlockModal handing off to
 * /courses/[id].
 */
export function ActivationGate({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();

  // The layout mounts outside each page's ProtectedSurface, so repeat the
  // teacher check here — a signed-in learner who lands on /teach is already
  // refused by the page, and stacking this dialog on top of that refusal would
  // tell them to pay for a studio they were never asking for.
  const isTeacher = Boolean(
    user && hasAnyPermission({ roles: user.roles }, ["teacherStudio.access"]),
  );
  // /teach/activate is the checkout itself and /teach/activate/return is where
  // Stripe sends them back. Gating those traps the creator with no way to pay.
  const onActivationRoute = pathname === "/teach/activate"
    || pathname?.startsWith("/teach/activate/") === true;
  if (!isTeacher || onActivationRoute) return children;

  // Account changes and leaving for checkout reset the check. Ordinary studio
  // navigation preserves the mounted advisor and its unsent draft.
  return <ActivationCheck key={user?.uid}><AdvisorSidebar>{children}</AdvisorSidebar></ActivationCheck>;
}

function ActivationCheck({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"loading" | "allowed" | "blocked" | "error">("loading");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetchCreatorActivationBlocked()
      .then((value) => {
        if (active) setPhase(value ? "blocked" : "allowed");
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  // Focus trap and scroll lock follow what is on screen, not what the fetch
  // returned: a stale `blocked` on the checkout route would otherwise lock the
  // page scroll with no dialog rendered to explain it.
  const visible = phase !== "allowed";

  useModalFocus(dialogRef, visible);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) return children;

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
      <div className="modal-panel modal-panel-scroll relative z-[85] flex w-full max-w-md flex-col justify-center bg-white p-7 shadow-[0_30px_80px_rgba(15,39,68,0.32)] sm:rounded-[8px]">
        <h2
          id="activation-gate-title"
          className="text-xl font-semibold text-[var(--color-ink)]"
        >
          {t(`creatorPanel.activationGate.${phase === "loading" ? "checking" : phase === "error" ? "errorTitle" : "title"}`)}
        </h2>
        {phase === "blocked" ? <>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {t("creatorPanel.activationGate.fee").replace("{amount}", () => String(activationFeeUsd))}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {t("creatorPanel.activationGate.plan")}
        </p>
        <Link
          href="/teach/activate"
          className="button-solid mt-6 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
        >
          {t("creatorPanel.activationGate.pay").replace("{amount}", () => String(activationFeeUsd))}
        </Link>
        </> : phase === "error" ? <>
          <p role="alert" className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {t("creatorPanel.activationGate.errorBody")}
          </p>
          <button type="button" onClick={() => { setPhase("loading"); setAttempt((value) => value + 1); }} className="button-solid mt-6 min-h-11 px-4 py-2.5 text-sm">
            {t("creatorPanel.activationGate.retry")}
          </button>
        </> : (
          <p role="status" className="mt-3 text-sm text-[var(--color-ink-soft)]">
            {t("creatorPanel.activationGate.checkingBody")}
          </p>
        )}
        <Link
          href="/"
          className="mt-3 inline-flex w-full items-center justify-center text-xs text-[var(--color-ink-soft)] underline underline-offset-4"
        >
          {t("creatorPanel.activationGate.leave")}
        </Link>
      </div>
    </div>
  );
}
