"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { EmbeddedCheckoutPanel } from "@/components/account/embedded-checkout-panel";
import type { PlanBillingCycle, PlanId } from "@/data/plans";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { useTranslation } from "@/components/i18n/i18n-provider";

type UpgradeModalProps = {
  open: boolean;
  planId: Exclude<PlanId, "free"> | null;
  cycle: PlanBillingCycle;
  onClose: () => void;
};

// Modal that wraps the embedded Stripe checkout. Lives on top of the
// platform shell with a darkened backdrop so the upgrade flow is the
// only thing in focus. Replaces the dedicated /account/billing/upgrade
// page (still kept as a fallback for direct-link arrivals).
export function UpgradeModal({
  open,
  planId,
  cycle,
  onClose,
}: UpgradeModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus(dialogRef, open && Boolean(planId));

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !planId) {
    return null;
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex items-stretch justify-center outline-none sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
    >
      <button
        type="button"
        className="dialog-backdrop absolute inset-0"
        aria-label={t("billingCheckout.close")}
        onClick={onClose}
      />
      {/* The app's standard panel from sm up; on the phone it stays full screen,
          without corner or border. */}
      <div className="dialog-panel dialog-panel--xl modal-panel relative z-[75] flex flex-col overflow-hidden max-sm:rounded-none max-sm:border-0">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("billingCheckout.secure")}
            </p>
            <h2
              id="upgrade-modal-title"
              className="display-title mt-1 text-xl text-[var(--color-primary)] sm:text-2xl"
            >
              {t("billingCheckout.confirm")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="button-icon"
            aria-label={t("billingCheckout.close")}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-soft)] p-4 sm:p-6">
          <EmbeddedCheckoutPanel planId={planId} cycle={cycle} />
        </div>
      </div>
    </div>
  );
}
