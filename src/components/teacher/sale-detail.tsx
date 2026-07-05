"use client";

import Link from "next/link";
import { Copy, Mail, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import type { Order } from "@/domain/order";
import { subscribeToOrder } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";

type SaleDetailProps = {
  orderId: string;
};

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatOrderRef(id: string) {
  const tail = id.slice(-8).toUpperCase();
  return tail ? `#${tail}` : `#${id.toUpperCase()}`;
}

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) {
    return "Timestamp pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function CopyIdButton({ value, label }: { value: string | null; label: string }) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return <span className="text-[var(--color-ink-muted)]">Not available</span>;
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(value ?? "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)]"
      aria-label={`Copy ${label}`}
    >
      <Copy aria-hidden="true" size={13} strokeWidth={1.9} />
      {copied ? "Copied" : value}
    </button>
  );
}

function getTimeline(order: Order) {
  const items = [
    {
      label: "Order created",
      detail: "Skillset created the order record.",
      time: formatDate(order.createdAt),
    },
  ];

  if (order.checkoutSessionId) {
    items.push({
      label: "Checkout session created",
      detail: `Stripe session ${order.checkoutSessionId}`,
      time: formatDate(order.createdAt),
    });
  }

  if (order.paymentIntentId) {
    items.push({
      label: order.status === "paid" ? "Payment succeeded" : "Payment intent recorded",
      detail: `Stripe payment intent ${order.paymentIntentId}`,
      time: formatDate(order.updatedAt ?? order.createdAt),
    });
  }

  if (order.status === "paid") {
    items.push({
      label: "Enrollment activated",
      detail: "Course access is open for this learner.",
      time: formatDate(order.updatedAt ?? order.createdAt),
    });
  }

  if (order.status === "refunded" || order.status === "partially_refunded") {
    items.push({
      label: "Refund recorded",
      detail: "A full or partial refund was issued; refunded amounts are not paid out to you.",
      time: formatDate(order.updatedAt ?? order.createdAt),
    });
  }

  return items;
}

export function SaleDetail({ orderId }: SaleDetailProps) {
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToOrder(
      orderId,
      (nextOrder) => {
        setOrder(nextOrder);
        setIsLoading(false);
      },
      () => {
        setError("We could not load this sale.");
        setIsLoading(false);
      },
    );
  }, [orderId]);

  if (isLoading) {
    return (
      <section className="settings-section-card">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading sale...</p>
      </section>
    );
  }

  if (error || !order) {
    return (
      <section className="settings-section-card">
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error || "Sale not found."}
        </p>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          Back to Teacher Studio
        </Link>
      </section>
    );
  }

  const canView =
    user?.roles.includes("admin") || user?.uid === order.teacherId || user?.uid === order.userId;
  const platformFeeMinor = Math.floor((order.amountMinor * order.platformFeeBps) / 10000);
  const creatorNetMinor = order.amountMinor - platformFeeMinor;
  const timeline = getTimeline(order);

  if (!canView) {
    return (
      <section className="settings-section-card">
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          You do not have access to this sale. Sign in with the account that owns it, or contact support.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-5">
        <section className="settings-section-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                Sale
              </p>
              <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
                Order {formatOrderRef(order.id)}
              </h2>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-6 text-[var(--color-ink-soft)]">
                Full order ID
                <CopyIdButton value={order.id} label="order ID" />
              </p>
              <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
                Created {formatDate(order.createdAt)} - Updated{" "}
                {formatDate(order.updatedAt ?? order.createdAt)}
              </p>
            </div>
            <StatusChip status={order.status} />
          </div>
        </section>

        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Customer
          </p>
          <div className="mt-4 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Learner account
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-5 text-[var(--color-ink-soft)]">
              Account ID
              <CopyIdButton value={order.userId} label="learner account ID" />
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
              The learner&apos;s name and email are not attached to this order.
              Use the account ID when contacting support about it.
            </p>
          </div>
        </section>

        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Payment
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["Amount", formatMoney(order.amountMinor, order.currency)],
              ["Skillset fee", formatMoney(platformFeeMinor, order.currency)],
              ["Net before Stripe fee", formatMoney(creatorNetMinor, order.currency)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                  {label}
                </p>
                <p className="mt-2 text-lg font-bold text-[var(--color-primary)]">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 rounded-[14px] border fine-rule bg-white p-4 text-xs text-[var(--color-ink-soft)]">
            <p>
              Provider <strong className="text-[var(--color-ink)]">{order.provider}</strong>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              Payment intent
              <CopyIdButton value={order.paymentIntentId} label="payment intent ID" />
            </p>
            <p className="flex flex-wrap items-center gap-2">
              Checkout session
              <CopyIdButton value={order.checkoutSessionId} label="checkout session ID" />
            </p>
          </div>
        </section>

        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Timeline
          </p>
          <div className="mt-5 grid gap-4">
            {timeline.map((item) => (
              <div key={`${item.label}-${item.time}`} className="flex gap-3">
                <span className="mt-1 size-2.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                    {item.detail}
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {item.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Actions
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={`/learn/courses/${order.courseSlug}`}
              className="button-outline inline-flex items-center gap-2 px-3.5 py-2 text-xs"
            >
              View enrollment in workspace
            </Link>
            <a
              href="mailto:support@skillsetmind.com"
              className="button-outline inline-flex items-center gap-2 px-3.5 py-2 text-xs"
            >
              <Mail aria-hidden="true" size={14} />
              Contact support
            </a>
            <a
              href={`mailto:support@skillsetmind.com?subject=${encodeURIComponent(
                `Refund request - order ${order.id}`,
              )}&body=${encodeURIComponent(
                `Please help me process a refund for order ${order.id} (${order.courseTitle}).`,
              )}`}
              className="button-outline inline-flex items-center gap-2 px-3.5 py-2 text-xs"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Request refund
            </a>
          </div>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Course
          </p>
          <h3 className="mt-3 text-lg font-bold leading-7 text-[var(--color-ink)]">
            {order.courseTitle}
          </h3>
          <div className="mt-4 grid gap-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            <p>Course ID {order.courseId}</p>
            <p>Slug {order.courseSlug}</p>
            <p>Currency {order.currency}</p>
          </div>
          <Link
            href={`/courses/${order.courseSlug}`}
            className="button-outline mt-5 px-3.5 py-2 text-xs"
          >
            View public course
          </Link>
        </section>      </aside>
    </div>
  );
}
