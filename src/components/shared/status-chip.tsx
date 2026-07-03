"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/cn";

export type StatusChipStatus =
  | "active"
  | "cancelled"
  | "completed"
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
  | "published"
  | "refunded"
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
  "published",
  "refunded",
  "resolved",
  "reviewed",
  "revoked",
  "succeeded",
]);

const statusVariants: Record<string, string> = {
  active: "success",
  completed: "success",
  paid: "success",
  published: "success",
  resolved: "success",
  succeeded: "success",
  draft: "draft",
  in_review: "warning",
  needs_changes: "danger",
  failed: "danger",
  cancelled: "inactive",
  dismissed: "inactive",
  expired: "inactive",
  inactive: "inactive",
  revoked: "inactive",
  open: "info",
  partially_refunded: "info",
  pending: "info",
  refunded: "info",
  reviewed: "info",
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
