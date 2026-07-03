"use client";

import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Enrollment } from "@/domain/enrollment";
import { requestEnrollmentRefund } from "@/lib/payments/refunds";

export function RefundButton({ enrollment }: { enrollment: Enrollment }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [hasError, setHasError] = useState(false);

  if (
    enrollment.source !== "payment"
    || !["active", "completed"].includes(enrollment.status)
    || enrollment.progressPercent >= 50
  ) {
    return null;
  }

  async function handleRefund() {
    const confirmed = window.confirm(t("learn.refund.confirm"));

    if (!confirmed) {
      return;
    }

    setStatus("loading");
    setHasError(false);

    try {
      await requestEnrollmentRefund(enrollment.id);
      setStatus("sent");
    } catch {
      setHasError(true);
      setStatus("idle");
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={handleRefund}
        disabled={status !== "idle"}
        className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {status === "loading"
          ? t("learn.refund.requesting")
          : status === "sent"
            ? t("learn.refund.requested")
            : t("learn.refund.request")}
      </button>
      {hasError ? (
        <p className="text-xs font-semibold text-[var(--color-accent-fg)]">
          {t("learn.refund.error")}
        </p>
      ) : null}
    </div>
  );
}
