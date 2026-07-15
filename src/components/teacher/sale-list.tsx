"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import type { Order } from "@/domain/order";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) {
    return "Date pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(date);
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

export function SaleList() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setIsLoading(false);
      },
      () => {
        setError("We could not load your sales. Refresh to try again.");
        setIsLoading(false);
      },
    );
  }, [user]);

  if (isLoading) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">
          Loading your sales...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] p-6">
        <p className="text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      </section>
    );
  }

  if (orders.length === 0) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-8 text-center shadow-[var(--shadow-soft)]">
        <h2 className="display-title text-2xl text-[var(--color-primary)]">
          No sales yet.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          When a learner completes checkout for one of your courses, the order
          appears here with its payment trail and payout status.
        </p>
        <Link
          href="/teach/builder"
          className="button-solid mt-6 inline-flex px-4 py-2.5 text-sm"
        >
          Go to your courses
        </Link>
      </section>
    );
  }

  const sortedOrders = [...orders].sort(
    (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
  );
  const visibleOrders = sortedOrders.slice(0, 50);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {orders.length} {orders.length === 1 ? "order" : "orders"} (most
          recent 50)
        </p>
        <Link
          href="/account/payments"
          className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
        >
          Payout wallet &rarr;
        </Link>
      </div>
      <ul className="grid gap-3">
        {visibleOrders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/teach/sales/${order.id}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] transition-colors hover:border-[var(--color-primary-light)]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--color-primary)]">
                  {order.courseTitle}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {formatDate(order.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <StatusChip status={order.status} />
                <span className="text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
