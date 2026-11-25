import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui";

/**
 * The studio's number card, a single design. There used to be seven: blue with a
 * 36px number on Home, gray with 24px on Reports, weight 900 on Earnings, a strip with no
 * card on Events... and none with fixed-width digits, so numbers
 * in a row did not line up. White card, 12px uppercase label,
 * number in `.num` (tabular) at 24px, optional 12px hint.
 *
 * The value comes ready from the caller: each screen knows when the number is
 * "Unavailable" (a failed read never becomes zero). `unavailable` only changes the
 * look, so the word does not look like a number.
 *
 * `labelAs="dt"`: the card lives in a <dl> and becomes dt/dd; otherwise the label is the
 * requested element (p, h2, h3), following the screen's heading order.
 */
export function MetricCard({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  loading = false,
  unavailable = false,
  labelAs: Label = "p",
  srOnlyHint = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  unavailable?: boolean;
  labelAs?: "p" | "dt" | "h2" | "h3";
  /** The hint is for screen readers only (narrow strips, like Events). */
  srOnlyHint?: boolean;
}) {
  const Item = Label === "dt" ? "dd" : "p";
  const title = (
    <Label className="break-words text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
      {label}
    </Label>
  );
  return (
    <Card as={Label === "dt" ? "div" : "article"} padding="sm">
      {/* In a <dl> the dt is a direct child of the group: the icon only exists outside it. */}
      {Icon ? (
        <div className="flex items-start justify-between gap-3">
          {title}
          <Icon aria-hidden="true" size={16} className="shrink-0 text-[var(--color-accent-fg)]" />
        </div>
      ) : (
        title
      )}
      {loading ? (
        <Item className="mt-3 h-8 w-24 animate-pulse rounded bg-[var(--color-surface-strong)]" />
      ) : (
        <Item
          className={
            unavailable
              ? "mt-3 text-base font-semibold leading-8 text-[var(--color-ink-soft)]"
              : "num mt-3 break-words text-2xl font-bold leading-8 text-[var(--color-primary)]"
          }
        >
          {value}
        </Item>
      )}
      {!loading && trend ? <div className="mt-2">{trend}</div> : null}
      {hint ? (
        <Item className={srOnlyHint ? "sr-only" : "mt-2 text-xs leading-5 text-[var(--color-ink-soft)]"}>{hint}</Item>
      ) : null}
    </Card>
  );
}
