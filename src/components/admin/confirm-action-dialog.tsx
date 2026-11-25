"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Asks before /ops actions that take something offline or reject someone
 * (I-04): they were a single click, in the same outline as "Request changes".
 *
 * Thin shell over the platform's single dialog (`ui/confirm-dialog`), so the
 * admin has only one implementation: native <dialog> with showModal(), focus that
 * starts on the safe side and returns to whoever opened it, Esc, the double-tap lock and the
 * lock while saving (both buttons stop and Esc does not close; a double
 * click saves once and does not land on the button below).
 *
 * The caller's contract stays as it was here: the panel already shows the error in
 * its own place (the promise does not reject), so the dialog also closes when the
 * write fails, instead of opening a second notice inside it.
 */
export function ConfirmActionDialog({ title, body, confirmLabel, onConfirm, onClose }: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel={t("platform.ops.confirmDialog.cancel")}
      danger
      onConfirm={async () => {
        try {
          await onConfirm();
        } catch {
          // The caller already warns in the panel; here it only closes, as before.
        }
      }}
      onClose={onClose}
    >
      {body}
    </ConfirmDialog>
  );
}
