"use client";

import { useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
  * Asks before an action that cannot be undone, in the platform's dialog in place
  * of window.confirm (the browser's gray box, unbranded, with an "OK /
  * Cancel" that does not say what happens). `ask` stores the question; the dialog mounts
  * only while it exists and `run` runs once, on confirm: it is the same code
  * that ran when confirm() returned true. `acknowledge`: a one-button
  * notice (it was window.alert).
 */
export type ConfirmRequest = {
  title: string;
  /** The sentence that already existed in window.confirm. */
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  acknowledge?: boolean;
  run: () => unknown;
  /** Closed without confirming (Cancel, Esc). Optional. */
  onCancel?: () => void;
};

export function useConfirm(): {
  ask: (request: ConfirmRequest) => void;
  asking: boolean;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // The dialog calls onClose in both outcomes; this separates "confirmed" from
  // "gave up". It only becomes true when run finishes with no error (on error the
  // dialog stays open).
  const confirmedRef = useRef(false);
  return {
    ask: setRequest,
    asking: request !== null,
    dialog: request ? (
      <ConfirmDialog
        title={request.title}
        confirmLabel={request.confirmLabel}
        {...(request.acknowledge
          ? { acknowledge: true as const }
          : { cancelLabel: request.cancelLabel ?? t("creatorEditor.builder.curriculum.cancel") })}
        danger={request.danger}
        onConfirm={async () => {
          await request.run();
          confirmedRef.current = true;
        }}
        onClose={() => {
          if (!confirmedRef.current) request.onCancel?.();
          confirmedRef.current = false;
          setRequest(null);
        }}
      >
        {request.body}
      </ConfirmDialog>
    ) : null,
  };
}
