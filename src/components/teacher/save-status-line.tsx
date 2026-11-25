"use client";

import { CheckCircle2 } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, InlineAlert } from "@/components/ui";

/**
 * Error with a way out: the sentence in the error red (announced) and, below, a
 * "Try again" that repeats the SAME request. Before, the error came out in the success gray
 * and the person had nothing to click besides reloading the page.
 */
export function RetryAlert({
  text,
  onRetry,
  busy = false,
  className = "",
}: {
  text: string;
  onRetry?: () => void;
  /** Trying again: the notice stays, and the button shows the wait. */
  busy?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`grid justify-items-start gap-2 ${className}`}>
      <InlineAlert tone="error">{text}</InlineAlert>
      {onRetry ? (
        // The same "Try again" on both faces; only the ring comes in, in the already reserved spot.
        <Button variant="outline" loading={busy} busyLabel={t("saveStatus.retry")} onClick={onRetry}>
          {t("saveStatus.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The line next to the "Save" of the button editors (sales text and sales
 * page). It only says what is true: "Unsaved changes" as soon as what is on
 * screen differs from the last saved value, the saved sentence only when they are equal, and the
 * error with "Try again". While saving it says nothing: the button itself already says
 * "Saving...". Before, "Saved." stayed on screen while the person went back to
 * typing, and what was not saved looked saved.
 */
export function SaveStatusLine({
  saving,
  dirty,
  savedText,
  errorText,
  onRetry,
}: {
  saving: boolean;
  dirty: boolean;
  /** Only after a save that succeeded in this visit. */
  savedText?: string;
  errorText?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (saving) return null;
  if (errorText) return <RetryAlert text={errorText} onRetry={onRetry} className="basis-full" />;
  if (dirty) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-muted)]">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--color-ink-muted)]" />
        {t("saveStatus.unsaved")}
      </span>
    );
  }
  if (savedText) return <SavedNote text={savedText} />;
  return null;
}

/**
 * The "saved" message of the teacher and account forms: a green check and the sentence, on the
 * same line as the button that saved. Before, each panel had its own (blue box,
 * green box, gray text), and three of them showed up ABOVE the button, pushing it
 * about 48px down right after the click. The error stays in the InlineAlert.
 */
export function SavedNote({ text }: { text: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-success-fg)]">
      <CheckCircle2 aria-hidden="true" size={16} className="shrink-0" />
      {text}
    </span>
  );
}
