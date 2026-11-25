"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useLegalGateWaiting } from "@/components/auth/legal-gate-state";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpotArt, type SpotArtScene } from "@/components/ui/spot-art";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useWelcomeTour } from "@/lib/ui/use-welcome-tour";

type TourStep = {
  // The step's engraving strip (in place of the small round icon).
  scene: SpotArtScene;
  title: string;
  body: string;
};

function buildSteps(firstName: string, t: (key: string) => string): TourStep[] {
  const welcomeTitle = firstName
    ? t("teach.tour.welcomeNamed").replace("{name}", () => firstName)
    : t("teach.tour.welcome");

  // Two steps: "Publish and sell" and "Earnings and help" left, because the studio's
  // next-steps list already leads to them. Help stayed on step 2.
  return [
    {
      scene: "firstProduct",
      title: welcomeTitle,
      body: t("teach.tour.step1Body"),
    },
    {
      scene: "firstLesson",
      title: t("teach.tour.step2Title"),
      body: t("teach.tour.step2Body"),
    },
  ];
}

type TeacherWelcomeTourProps = {
  userId: string;
  firstName: string;
  hasProducts?: boolean;
};

// The terms dialog comes first (the same as in the learner tour): while it is
// on screen, or we do not know yet, the tour does not mount and does not mark "seen".
export function TeacherWelcomeTour(props: TeacherWelcomeTourProps) {
  return useLegalGateWaiting() ? null : <TeacherWelcomeTourDialog {...props} />;
}

function TeacherWelcomeTourDialog({
  userId,
  firstName,
  hasProducts = false,
}: TeacherWelcomeTourProps) {
  const { t } = useTranslation();
  const { open, dismiss } = useWelcomeTour(userId, "teacher");
  const [stepIndex, setStepIndex] = useState(0);
  // The same as the learner tour (learn/welcome-tour.tsx): only after the first
  // step change do the text and scene rise in. On opening the dialog already
  // enters through .modal-panel; both together made the animation play twice.
  const [stepChanged, setStepChanged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const steps = buildSteps(firstName, t);

  useModalFocus(dialogRef, open);

  function goToStep(next: number) {
    setStepChanged(true);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, next)));
  }

  // Changed step: focus goes to the new title. Going back to step 1 takes the
  // "Back" off the screen with focus on it, and focus fell behind the dialog.
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
        aria-labelledby="teacher-welcome-tour-title"
        className="dialog-panel modal-panel modal-panel-scroll overflow-hidden outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Narrow engraving strip with the step's scene (fixed height, h-20).
            key: switching steps remounts the scene and it enters again. A single
            skip control, the footer "Skip" (and Esc): the X at the top
            ("Skip the tour") did the same thing. */}
        <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-6 py-3">
          <SpotArt key={step.scene} scene={step.scene} className={`mx-auto h-20 w-auto ${stepChanged ? "spot-art-in" : ""}`} />
        </div>

        {/* The steps in the same grid cell: the box has the height of the
            longest step, so switching steps does not move the buttons
            below. Only the current one shows (and exists for the screen reader). */}
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
                  id={current ? "teacher-welcome-tour-title" : undefined}
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

        {/* Fixed-width dashes: only the current one's color changes (before, the active one
            grew from 6 to 24px and redid the layout). */}
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

        {/* The house footer (hairline, breathing room), but without stacking on the phone:
            Back only shows from the 2nd step, and stacked it would change the height
            of the dialog between steps. Skip stays on the left. */}
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
            {/* The tour only described and ended at "Open your studio", which only
                closed. With no product yet, the last page leads to the action it
                described: creating the first product. */}
            {isLast && !hasProducts ? (
              <Link
                href="/teach/builder?newCourse=1&format=course"
                onClick={dismiss}
                className="button-solid shrink-0 px-4 py-2 text-sm"
              >
                {t("creatorPanel.home.products.firstCta")}
              </Link>
            ) : isLast ? (
              <button type="button" onClick={dismiss} className="button-solid shrink-0 px-4 py-2 text-sm">
                {t("teach.tour.openStudio")}
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
