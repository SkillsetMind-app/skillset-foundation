"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/cn";

export type StatusChipStatus =
  | "active"
  | "cancelled"
  | "completed"
  | "deleting"
  | "dismissed"
  | "draft"
  | "expired"
  | "failed"
  | "inactive"
  | "in_review"
  | "needs_changes"
  | "open"
  | "paid"
  | "partially_refunded"
  | "pending"
  | "processing"
  | "published"
  | "refunded"
  | "rejected"
  | "resolved"
  | "reviewed"
  | "revoked"
  | "succeeded";

type StatusChipProps = {
  status: StatusChipStatus | string;
  label?: string;
  className?: string;
};

// Statuses with a dictionary entry under statusChip.* — anything else renders
// as a prettified fallback instead of leaking a raw translation key.
const knownStatuses = new Set([
  "active",
  "cancelled",
  "completed",
  "deleting",
  "dismissed",
  "draft",
  "expired",
  "failed",
  "inactive",
  "in_review",
  "needs_changes",
  "open",
  "paid",
  "partially_refunded",
  "pending",
  "processing",
  "published",
  "refunded",
  "rejected",
  "resolved",
  "reviewed",
  "revoked",
  "succeeded",
]);

const statusVariants: Record<string, string> = {
  active: "success",
  approved: "success",
  completed: "success",
  paid: "success",
  published: "success",
  resolved: "success",
  succeeded: "success",
  draft: "draft",
  in_review: "warning",
  // Deleted product waiting for the cleanup of files and videos (pending queue).
  deleting: "warning",
  needs_changes: "danger",
  rejected: "danger",
  failed: "danger",
  cancelled: "inactive",
  canceled: "inactive",
  dismissed: "inactive",
  expired: "inactive",
  inactive: "inactive",
  revoked: "inactive",
  open: "info",
  partially_refunded: "info",
  pending: "info",
  processing: "info",
  past_due: "danger",
  trialing: "info",
  unpaid: "danger",
  paused: "inactive",
  incomplete: "warning",
  incomplete_expired: "inactive",
  refunded: "info",
  reviewed: "info",
  // The teacher's own domain: waiting for DNS/verification is a warning, failure is
  // danger — the same variants the rest of the studio uses (P-26).
  pending_dns: "warning",
  pending_verification: "warning",
  error: "danger",
  // Suspended or blocked account needs attention in /ops; it used to fall into the draft gray (I-05).
  suspended: "warning",
  blocked: "danger",
};

export function StatusChip({ status, label, className }: StatusChipProps) {
  const { t } = useTranslation();
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, "_");
  const variant = statusVariants[normalizedStatus] ?? "draft";
  const displayLabel =
    label ??
    (knownStatuses.has(normalizedStatus)
      ? t(`statusChip.${normalizedStatus}`)
      : normalizedStatus.replaceAll("_", " "));

  return (
    <span
      className={cn("status-chip", `status-chip--${variant}`, className)}
      data-status={normalizedStatus}
    >
      <span className="status-chip__dot" aria-hidden="true" />
      {displayLabel}
    </span>
  );
}
