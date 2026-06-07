"use client";

import { useState } from "react";

import type { Enrollment } from "@/domain/enrollment";
import { requestEnrollmentRefund } from "@/lib/payments/refunds";

export function RefundButton({ enrollment }: { enrollment: Enrollment }) {
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState("");

  if (
    enrollment.source !== "payment"
    || !["active", "completed"].includes(enrollment.status)
    || enrollment.progressPercent >= 50
  ) {
    return null;
  }

  async function handleRefund() {
    const confirmed = window.confirm(
      "Request a refund for this course? If approved, access will be removed after Stripe confirms the refund.",
    );

    if (!confirmed) {
      return;
    }

    setStatus("loading");
    setError("");

    try {
      await requestEnrollmentRefund(enrollment.id);
      setStatus("sent");
    } catch {
      setError("Refund request failed or is no longer eligible.");
      setStatus("idle");
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={handleRefund}
        disabled={status !== "idle"}
        className="button-outline px-4 py-3 text-sm disabled:opacity-60"
      >
        {status === "loading"
          ? "Requesting refund..."
          : status === "sent"
            ? "Refund requested"
            : "Request refund"}
      </button>
      {error ? (
        <p className="text-xs font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
