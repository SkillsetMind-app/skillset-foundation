"use client";

import { LayoutDashboard, PenTool, Store, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useModalFocus } from "@/lib/a11y/use-modal-focus";

// First-run welcome tour for the creator studio. Mirrors the members-area
// WelcomeTour (self-contained modal, no backend, no tour library) but teaches
// the four things a new producer needs: build, sell, get paid, get help.
//
// ponytail: strings are hardcoded English to match the rest of the producer
// dashboard (which is English-first, not i18n'd, unlike the /learn surface).
// Move to a `teach.tour` i18n block when the studio gets localized — not worth
// three-file JSON surgery while the surrounding surface is still hardcoded.
//
// ponytail: "seen" state is localStorage (per-device), same trade-off as the
// learner tour. Upgrade to a user_profiles column only if cross-device
// suppression ever matters.

type TourStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function buildSteps(firstName: string): TourStep[] {
  const welcomeTitle = firstName ? `Welcome to your studio, ${firstName}` : "Welcome to your studio";

  return [
    {
      icon: LayoutDashboard,
      title: welcomeTitle,
      body: "This is your creator studio — build products, sell them, and get paid, all in one place. Your next steps are always waiting for you right here on this home.",
    },
    {
      icon: PenTool,
      title: "Create your first product",
      body: "Open the builder to add lessons. For each lesson video you can upload a file or paste a YouTube / Vimeo link — both work out of the box, so start with whatever you already have.",
    },
    {
      icon: Store,
      title: "Publish and sell",
      body: "Set your price, publish to your storefront, and students enroll instantly. Private per-course messages and the community keep them engaged after they buy.",
    },
    {
      icon: Wallet,
      title: "Get paid — and get help",
      body: "Connect Stripe once, and from then on every buyer pays your Stripe account directly: the charge is created on your own Stripe account and SkillsetMind never holds it. Stripe then settles the funds into your balance on its own timing — that depends on your country and the buyer's payment method — and pays them out to your bank on your connected account's payout schedule (new accounts are verified before the first payout). And your studio advisor, down in the bottom-right corner, is here whenever you want a second opinion.",
    },
  ];
}

const SEEN_KEY_PREFIX = "skillset:teacher-welcome-tour:seen:";
const EMPTY_SUBSCRIBE = () => () => {};

// Read the localStorage "seen" flag without a set-state-in-effect (which the
// codebase lints against) and without a hydration mismatch: the server snapshot
// is `true` so nothing renders during SSR, and React reconciles the real client
// value after hydration. No subscription — the flag only changes via dismiss().
function useHasSeenTour(seenKey: string) {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => window.localStorage.getItem(seenKey) !== null,
    () => true,
  );
}

export function TeacherWelcomeTour({ userId, firstName }: { userId: string; firstName: string }) {
  const seenKey = `${SEEN_KEY_PREFIX}${userId}`;
  const hasSeen = useHasSeenTour(seenKey);
  const [dismissed, setDismissed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const steps = buildSteps(firstName);
  const open = !hasSeen && !dismissed;

  useModalFocus(dialogRef, open);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        window.localStorage.setItem(seenKey, "1");
        setDismissed(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, seenKey]);

  function dismiss() {
    window.localStorage.setItem(seenKey, "1");
    setDismissed(true);
  }

  if (!open) {
    return null;
  }

  const step = steps[stepIndex];
  const Icon = step.icon;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,31,58,0.45)] p-4"
      role="presentation"
      onMouseDown={dismiss}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-welcome-tour-title"
        className="w-full max-w-md overflow-hidden rounded-[18px] border border-[var(--color-line)] bg-white shadow-[0_24px_60px_rgba(15,31,58,0.28)] outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip the tour"
            className="rounded-full p-1 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 pb-2 pt-4">
          <h2
            id="teacher-welcome-tour-title"
            className="display-title text-3xl leading-tight text-[var(--color-primary)]"
          >
            {step.title}
          </h2>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">{step.body}</p>
        </div>

        <div className="flex items-center gap-2 px-6 py-3" aria-hidden="true">
          {steps.map((item, index) => (
            <span
              key={item.title}
              className={[
                "h-1.5 rounded-full transition-all",
                index === stepIndex
                  ? "w-6 bg-[var(--color-primary)]"
                  : "w-1.5 bg-[var(--color-line)]",
              ].join(" ")}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-6 py-4">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                className="button-outline px-4 py-2 text-sm"
              >
                Back
              </button>
            ) : null}
            {isLast ? (
              <button type="button" onClick={dismiss} className="button-solid px-4 py-2 text-sm">
                Open your studio
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStepIndex((index) => Math.min(steps.length - 1, index + 1))}
                className="button-solid px-4 py-2 text-sm"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
