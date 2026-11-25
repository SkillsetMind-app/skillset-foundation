import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type AlertTone = "error" | "warning" | "success" | "info";

/**
 * The project has 187 surfaces painted error red and 23 role="alert"
 * in total. That is: the overwhelming majority of error messages are never
 * announced by a screen reader — someone who cannot see the screen submits the form,
 * nothing audible happens, and the person does not know it failed.
 *
 * The announcement is not an optional prop here. It comes with the color, always.
 */
const toneClass: Record<AlertTone, string> = {
  error:
    "border-[rgba(178,34,52,0.2)] bg-[var(--color-danger-soft)] text-[var(--color-danger-fg)]",
  warning:
    "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning-fg)]",
  success:
    "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success-fg)]",
  info: "border-[var(--color-line)] bg-[var(--color-info-soft)] text-[var(--color-ink-soft)]",
};

// One icon per tone: without it the only difference between error, warning and success was
// color, and whoever cannot tell red from green was left with no signal at all.
const toneIcon: Record<AlertTone, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

export type InlineAlertProps = {
  tone: AlertTone;
  title?: string;
  className?: string;
  children: ReactNode;
};

export function InlineAlert({ tone, title, className, children }: InlineAlertProps) {
  // "assertive" interrupts the reading to deliver the bad news; "polite" waits for the
  // current sentence to finish. Error is the only thing that deserves to interrupt.
  const urgent = tone === "error";
  // Six teacher and admin screens already arrange their own children in flex (one
  // with its own icon). They carry on as before, with no icon and no inner wrapper: the new
  // icon must not push the button or duplicate their symbol.
  const ownLayout = /(^|\s)flex(\s|$)/.test(className ?? "");
  const Icon = toneIcon[tone];
  const content = (
    <>
      {title ? <p className="font-bold">{title}</p> : null}
      {children}
    </>
  );

  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm font-semibold leading-6",
        !ownLayout && "flex items-start gap-2",
        toneClass[tone],
        className,
      )}
    >
      {ownLayout ? (
        content
      ) : (
        <>
          {/* h-[1lh]: the icon box is the height of ONE line of text, so
              it stays centered on the first line at any size (text-xs or
              text-sm) and text that wraps lines up under the text, not under it. */}
          <span className="flex h-[1lh] shrink-0 items-center">
            <Icon aria-hidden="true" size={16} strokeWidth={2.2} />
          </span>
          {/* A plain sentence goes straight into the box, as before (the case for almost
              all uses); a title or pieces with a link get an inner wrapper, so
              they do not become side-by-side columns. */}
          {title || typeof children !== "string" ? <div className="min-w-0 flex-1">{content}</div> : children}
        </>
      )}
    </div>
  );
}
