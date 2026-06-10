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
      "Request a refund for this course? Refunds are available within 7 days of purchase if less than half the course is completed. If approved, your course access ends once the refund is processed.",
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
      setError("We could not submit this refund request. It may be outside the 7-day refund window — contact support if you think this is wrong.");
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
