"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { cn } from "@/lib/cn";

export type LoadErrorAlertProps = {
  children: ReactNode;
  /** Reads again. The alert is only dismissed when the screen receives the data: the screen decides. */
  onRetry: () => Promise<unknown> | void;
  /** Node that stays on screen in both outcomes and receives focus on click. */
  focusRef: RefObject<HTMLElement | null>;
  /** A re-read that the screen tracks on its own (router.refresh). */
  busy?: boolean;
  className?: string;
  /** Spacing of the alert itself, for screens that already had it compact or wide. */
  alertClassName?: string;
};

/**
 * A READ error with a way out: the alert and a "Try again" that reads again. There were
 * about 39 "could not load" messages and only 7 with a button; the only way out
 * was reloading the page in the browser. (The teacher's RetryAlert is a different one:
 * it repeats a save, not a read.)
 *
 * The button locks while the re-read runs (aria-busy, "Trying again...").
 * Once locked it loses focus, and disappears when the read succeeds: that is why focus
 * goes first to `focusRef`, otherwise it would fall to the <body>.
 */
export function LoadErrorAlert({
  children,
  onRetry,
  focusRef,
  busy = false,
  className,
  alertClassName,
}: LoadErrorAlertProps) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  // Lock in the function itself too: two clicks before the screen redraws
  // do not start two re-reads.
  const inFlight = useRef(false);
  const locked = busy || retrying;

  async function retry() {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    focusRef.current?.focus();
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // The re-read failure already comes back as an error on the screen itself; the alert stays.
    } finally {
      inFlight.current = false;
      setRetrying(false);
    }
  }

  return (
    <div className={cn("grid gap-3", className)}>
      <InlineAlert tone="error" className={alertClassName}>{children}</InlineAlert>
      <Button
        variant="outline"
        className="justify-self-start"
        loading={locked}
        busyLabel={t("appErrors.retrying")}
        onClick={() => void retry()}
      >
        {t("appErrors.retry")}
      </Button>
    </div>
  );
}
