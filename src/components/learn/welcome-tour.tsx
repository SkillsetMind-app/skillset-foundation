"use client";

import { Award, GraduationCap, LifeBuoy, PlayCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLegalGateWaiting } from "@/components/auth/legal-gate-state";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useWelcomeTour } from "@/lib/ui/use-welcome-tour";

type TourStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function buildSteps(
  firstName: string,
  t: (key: string) => string,
): TourStep[] {
  // Every locale's welcomeNamed ends with ", {name}", so a nameless user just
  // gets the greeting with that suffix stripped instead of "Welcome, ".
  const welcomeTitle = firstName
    ? t("learn.tour.welcomeNamed").replace("{name}", () => firstName)
    : t("learn.tour.welcomeNamed").replace(", {name}", "");

  return [
    {
      icon: GraduationCap,
      title: welcomeTitle,
      body: t("learn.tour.step1Body"),
    },
    {
      icon: PlayCircle,
      title: t("learn.tour.step2Title"),
      body: t("learn.tour.step2Body"),
    },
    {
      icon: Award,
      title: t("learn.tour.step3Title"),
      body: t("learn.tour.step3Body"),
    },
    {
      icon: LifeBuoy,
      title: t("learn.tour.step4Title"),
      body: t("learn.tour.step4Body"),
    },
  ];
}

type WelcomeTourProps = { userId: string; firstName: string };

// The terms dialog comes first: with both open, two trapped Tabs fought each
// other and focus could end up on the tour, behind it. While it is on screen
// (or not yet known), the tour does not even mount, so it does not mark "seen" either.
export function WelcomeTour(props: WelcomeTourProps) {
  return useLegalGateWaiting() ? null : <WelcomeTourDialog {...props} />;
}

function WelcomeTourDialog({ userId, firstName }: WelcomeTourProps) {
  const { t } = useTranslation();
  const { open, dismiss } = useWelcomeTour(userId, "student");
  const [stepIndex, setStepIndex] = useState(0);
  // true after the first step change. On open, the dialog itself already
  // enters with motion-panel-in (.modal-panel); having the text rise too gave
  // the same animation twice.
  const [stepChanged, setStepChanged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const steps = buildSteps(firstName, t);

  useModalFocus(dialogRef, open);

  function goToStep(next: number) {
    setStepChanged(true);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, next)));
  }

  // Changed step: focus moves to the new title. Without this, going back to
  // step 1 removed "Back" from the screen with focus on it, and focus fell on
  // the page body, behind the dialog. On open, useModalFocus does the focusing.
  useEffect(() => {
    if (stepChanged) titleRef.current?.focus();
  }, [stepIndex, stepChanged]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) {
    return null;
  }

  const step = steps[stepIndex];
  const Icon = step.icon;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={dismiss}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        className="dialog-panel modal-panel modal-panel-scroll overflow-hidden outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* A single skip control, the "Skip" in the footer (and Esc). The X at
            the top ("Skip the tour") did the same thing. */}
        <div className="px-6 pt-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>

        {/* The four steps stacked in the same grid cell: the box has the height
            of the longest step, so changing step does not change the dialog
            height or move the buttons out from under the mouse. Only the
            current step appears (and exists for the screen reader); from the
            first change on it enters rising 8px (motion-panel-in, only when
            motion is allowed). */}
        <div className="grid px-6 pb-2 pt-4">
          {steps.map((item, index) => {
            const current = index === stepIndex;
            return (
              <div
                key={item.title}
                aria-hidden={current ? undefined : true}
                className={`[grid-area:1/1] ${current ? (stepChanged ? "motion-panel-in" : "") : "invisible"}`}
              >
                <h2
                  id={current ? "welcome-tour-title" : undefined}
                  ref={current ? titleRef : undefined}
                  tabIndex={current ? -1 : undefined}
                  className="display-title text-3xl leading-tight text-[var(--color-primary)] outline-none"
                >
                  {item.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">{item.body}</p>
              </div>
            );
          })}
        </div>

        {/* Fixed-width dashes: only the color of the current one changes. Before,
            the active one grew from 6 to 24px (transition-all, which redid the layout). */}
        <div className="flex items-center gap-2 px-6 py-3" aria-hidden="true">
          {steps.map((item, index) => (
            <span
              key={item.title}
              className={[
                "h-1.5 w-6 rounded-full transition-colors duration-[var(--duration-base)]",
                index === stepIndex ? "bg-[var(--color-primary)]" : "bg-[var(--color-line)]",
              ].join(" ")}
            />
          ))}
        </div>

        {/* The house footer (hairline rule, breathing room), but without
            stacking on a phone: Back only appears from the 2nd step, and
            stacked it would change the dialog height between steps. Skip stays
            on the left. */}
        <div className="dialog-footer flex-row flex-wrap items-center justify-between">
          <button
            type="button"
            onClick={dismiss}
            className="-ml-3 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            {t("learn.tour.skip")}
          </button>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => goToStep(stepIndex - 1)}
                className="button-outline shrink-0 px-4 py-2 text-sm"
              >
                {t("learn.tour.back")}
              </button>
            ) : null}
            {isLast ? (
              <button type="button" onClick={dismiss} className="button-solid shrink-0 px-4 py-2 text-sm">
                {t("learn.tour.startLearning")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToStep(stepIndex + 1)}
                className="button-solid shrink-0 px-4 py-2 text-sm"
              >
                {t("learn.tour.next")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
