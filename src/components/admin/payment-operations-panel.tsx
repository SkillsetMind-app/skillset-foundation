"use client";

import { useEffect, useMemo, useState } from "react";

import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import type { Order } from "@/domain/order";
import { subscribeToRecentOrders } from "@/lib/data/orders";

function formatMoney(amountMinor: number, currency: Order["currency"]) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function PaymentOperationsPanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToRecentOrders(
      (nextOrders) => {
        setOrders(nextOrders);
        setIsLoading(false);
      },
      () => {
        setError("We could not load recent Stripe orders.");
        setIsLoading(false);
      },
    );
  }, []);

  const totals = useMemo(() => {
    return orders.reduce(
      (summary, order) => {
        if (order.status === "paid") {
          summary.paid += 1;
          summary.grossMinor += order.amountMinor;
          summary.feeMinor += Math.floor(
            (order.amountMinor * order.platformFeeBps) / 10000,
          );
        }

        if (order.status === "refunded" || order.status === "partially_refunded") {
          summary.refunds += 1;
        }

        return summary;
      },
      { paid: 0, refunds: 0, grossMinor: 0, feeMinor: 0 },
    );
  }, [orders]);
  const exportRows = useMemo(
    () =>
      orders.map((order) => ({
        id: order.id,
        courseTitle: order.courseTitle,
        userId: order.userId,
        provider: order.provider,
        status: order.status,
        amount: formatMoney(order.amountMinor, order.currency),
        currency: order.currency,
        platformFeeBps: order.platformFeeBps,
      })),
    [orders],
  );

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Payments
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            Stripe order monitor.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            This panel tracks live Stripe orders. It is intentionally
            operational: no course access is granted unless payment is
            confirmed and the enrollment is created automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportTableButton filename="skillset-orders" rows={exportRows} />
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            Admin only
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Paid orders", String(totals.paid)],
          ["Gross paid", formatMoney(totals.grossMinor, "USD")],
          ["Platform fee est.", formatMoney(totals.feeMinor, "USD")],
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

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">Loading orders...</p>
        ) : orders.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No Stripe orders yet. After a paid checkout, pending and paid orders
            will appear here.
          </p>
        ) : (
          orders.map((order) => (
            <article
              key={order.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <StatusChip status={order.status} />
                  <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {order.courseTitle}
                  </h4>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1 text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency)}
                </span>
              </div>
              <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
                Order {order.id} - User {order.userId} - Provider {order.provider}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
