"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { cn } from "@/lib/cn";

/**
 * For how long, after opening, the confirm button ignores clicks. On
 * phones the buttons stack and the confirm button takes the full width right below
 * the center of the screen: on a double tap, the 1st tap opens the dialog and the 2nd would land
 * on it. The button still looks enabled; the click is only discarded.
 */
export const CONFIRM_GUARD_MS = 500;

/**
 * Confirmation of an action that cannot be undone (cancel a plan, request deletion).
 * Replaces `window.confirm`: the browser's gray box freezes the tab, has
 * nothing of the brand and "OK / Cancel" does not say what happens.
 *
 * Usage — mount it only while the question is open:
 *
 *   {asking ? (
 *     <ConfirmDialog
 *       title={t("planTrial.cancel")}
 *       confirmLabel={t("planTrial.cancel")}
 *       pendingLabel={t("planTrial.cancelling")}
 *       cancelLabel={t("planTrial.keepPlan")}
 *       danger
 *       onConfirm={cancelPlan}          // can be async
 *       onClose={() => setAsking(false)}
 *     >
 *       {sentence that already existed in window.confirm}
 *     </ConfirmDialog>
 *   ) : null}
 *
 * What it guarantees, so callers do not have to remember:
 * - native `<dialog>` opened with showModal(): the page behind becomes inert and
 *   focus does not leave the dialog;
 * - focus starts on "cancel" (the safe side) and returns to the button that opened it;
 * - Esc closes, except while the confirmation is in progress;
 * - during the first CONFIRM_GUARD_MS the confirm button does not respond (double tap);
 * - during `onConfirm` the button locks and shows `pendingLabel`: two clicks
 *   in a row fire the action only once;
 * - fits on the screen (.modal-panel, AGENTS.md) and has a 16px margin on phones;
 *   the entrance and the backdrop (--color-scrim) come from the same class, identical to the other
 *   dialogs.
 *
 * Errors — pick one of the two paths:
 * - `onConfirm` handles its own error and finishes normally: the dialog closes and
 *   the caller shows the result on the screen (this is what plans and privacy do);
 * - `onConfirm` rejects: the dialog STAYS open, unlocks the buttons and shows
 *   `errorLabel` (or a generic sentence) to try again or give up.
 *
 * Notice with no choice (`acknowledge`): a single button, the `confirmLabel`, with no
 * red and no double-tap guard, because acknowledging undoes nothing.
 * Two buttons that do the same thing (the "Close" next to "Stay") were read
 * as "leave anyway", and a quick tap fell into the guard. No `cancelLabel`.
 */
export type ConfirmDialogProps = ConfirmDialogBaseProps &
  ({ acknowledge?: false; cancelLabel: string } | { acknowledge: true; cancelLabel?: never });

type ConfirmDialogBaseProps = {
  title: string;
  /** Small label above the title. Optional. */
  eyebrow?: string;
  /** The body: the sentence that explains the consequence. */
  children: ReactNode;
  confirmLabel: string;
  /** Button text while `onConfirm` runs. Without it, confirmLabel stays. */
  pendingLabel?: string;
  /** Solid red on the confirm button (delete, cancel something that is paid). */
  danger?: boolean;
  onConfirm: () => unknown;
  /** Sentence shown inside the dialog if `onConfirm` rejects. */
  errorLabel?: string;
  /** Called when the dialog closes, by any path. Unmount here. */
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  eyebrow,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  errorLabel,
  onClose,
  acknowledge = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // State re-renders; the ref blocks the second click that arrives before that.
  const pendingRef = useRef(false);
  const openedAt = useRef(Number.POSITIVE_INFINITY);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    openedAt.current = Date.now();
    dialog?.querySelector<HTMLElement>("[data-confirm-cancel]")?.focus();
    return () => {
      // When the action disappears with the screen (the "Cancel plan" stops existing after
      // cancelling), there is nowhere to return focus to.
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  async function confirm() {
    if (pendingRef.current || (!acknowledge && Date.now() - openedAt.current < CONFIRM_GUARD_MS)) return;
    pendingRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      // The caller let the error bubble up: the dialog stays open and warns, instead
      // of vanishing silently with an unowned rejection.
      pendingRef.current = false;
      setPending(false);
      setFailed(true);
      return;
    }
    pendingRef.current = false;
    setPending(false);
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        // Esc: we close it ourselves to respect the "in progress" state.
        event.preventDefault();
        if (!pendingRef.current) dialogRef.current?.close();
      }}
      onClose={onClose}
      className="dialog-panel modal-panel modal-panel-scroll m-auto w-[calc(100%_-_2rem)] text-[var(--color-ink)]"
    >
      <div className="grid gap-2 p-6">
        {eyebrow ? (
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.18em]",
              danger ? "text-[var(--color-danger-fg)]" : "text-[var(--color-accent-fg)]",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2 id={titleId} className="display-title text-2xl leading-tight text-[var(--color-primary)]">
          {title}
        </h2>
        <div id={bodyId} className="text-sm leading-6 text-[var(--color-ink-soft)]">
          {children}
        </div>
        {failed ? (
          <InlineAlert tone="error" className="mt-2">
            {errorLabel ?? t("confirmDialog.error")}
          </InlineAlert>
        ) : null}
      </div>
      {/* The standard footer: below sm the buttons stack with the confirm button
          on top and Cancel below; from sm up they sit on the right, the
          safe one first. */}
      <div className="dialog-footer">
        {acknowledge ? null : (
          <Button
            variant="outline"
            data-confirm-cancel=""
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
          >
            {cancelLabel}
          </Button>
        )}
        {/* In the notice with no choice, initial focus goes to the single button. */}
        <Button
          variant={danger && !acknowledge ? "danger" : "solid"}
          className={danger && !acknowledge ? "button-danger-solid" : undefined}
          data-confirm-cancel={acknowledge ? "" : undefined}
          loading={pending}
          // Both labels in the same cell (busyLabel): the button does not grow
          // when "Delete" becomes "Deleting...". Without pendingLabel, as it was.
          busyLabel={pendingLabel || undefined}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
