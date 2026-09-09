"use client";

import { LayoutDashboard, PenTool, Store, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useWelcomeTour } from "@/lib/ui/use-welcome-tour";

type TourStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function buildSteps(firstName: string, t: (key: string) => string): TourStep[] {
  const welcomeTitle = firstName
    ? t("teach.tour.welcomeNamed").replace("{name}", () => firstName)
    : t("teach.tour.welcome");

  return [
    {
      icon: LayoutDashboard,
      title: welcomeTitle,
      body: t("teach.tour.step1Body"),
    },
    {
      icon: PenTool,
      title: t("teach.tour.step2Title"),
      body: t("teach.tour.step2Body"),
    },
    {
      icon: Store,
      title: t("teach.tour.step3Title"),
      body: t("teach.tour.step3Body"),
    },
    {
      icon: Wallet,
      title: t("teach.tour.step4Title"),
      body: t("teach.tour.step4Body"),
    },
  ];
}

export function TeacherWelcomeTour({ userId, firstName }: { userId: string; firstName: string }) {
  const { t } = useTranslation();
  const { open, dismiss } = useWelcomeTour(userId, "teacher");
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const steps = buildSteps(firstName, t);

  useModalFocus(dialogRef, open);

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
        className="modal-panel modal-panel-scroll w-full max-w-md overflow-hidden rounded-[18px] border border-[var(--color-line)] bg-white shadow-[0_24px_60px_rgba(15,31,58,0.28)] outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("learn.tour.skipTour")}
            className="grid h-11 w-11 place-items-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
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
            className="-ml-3 inline-flex min-h-11 items-center rounded-[8px] px-3 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            {t("learn.tour.skip")}
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                className="button-outline px-4 py-2 text-sm"
              >
                {t("learn.tour.back")}
              </button>
            ) : null}
            {isLast ? (
              <button type="button" onClick={dismiss} className="button-solid px-4 py-2 text-sm">
                {t("teach.tour.openStudio")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStepIndex((index) => Math.min(steps.length - 1, index + 1))}
                className="button-solid px-4 py-2 text-sm"
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
