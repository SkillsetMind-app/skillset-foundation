"use client";

import { Award, GraduationCap, LifeBuoy, PlayCircle, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useModalFocus } from "@/lib/a11y/use-modal-focus";

// First-run welcome tour for the members area. Self-contained: no backend, no
// tour library — a small multi-step modal that teaches the four things a new
// student needs, then remembers it's been seen.
//
// ponytail: "seen" state is localStorage, so it's per-device (a student on a
// second device sees it once more). Upgrade to a user_profiles.welcome_seen_at
// column if cross-device suppression ever matters — not worth a migration for a
// one-time dismissible intro.

type TourStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function buildSteps(firstName: string): TourStep[] {
  return [
    {
      icon: GraduationCap,
      title: `Welcome, ${firstName}`,
      body: "This is your learning home. Every course you enroll in lands here, and your progress is saved automatically as you go.",
    },
    {
      icon: PlayCircle,
      title: "Pick up where you left off",
      body: "Open any course to jump straight to your next lesson. Videos, downloadable materials, and lesson notes all live inside the classroom.",
    },
    {
      icon: Award,
      title: "Earn certificates, join the community",
      body: "Finish a course to unlock its certificate, and hop into the community space for courses that host one.",
    },
    {
      icon: LifeBuoy,
      title: "Manage your account",
      body: "Your plan, notifications, and profile live under Account. If anything looks off, support is one click away.",
    },
  ];
}

const SEEN_KEY_PREFIX = "skillset:welcome-tour:seen:";
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

export function WelcomeTour({ userId, firstName }: { userId: string; firstName: string }) {
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
        aria-labelledby="welcome-tour-title"
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
            id="welcome-tour-title"
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
                Start learning
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
