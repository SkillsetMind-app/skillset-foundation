"use client";

import {
  ArrowUpRight,
  BadgeDollarSign,
  Repeat2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  buildCreatorOpsSnapshot,
  type CurrencyAmount,
} from "@/domain/creator-ops";
import { calculateCreatorSubscriptionMetrics } from "@/domain/creator-subscriptions";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { CourseSubscription } from "@/domain/course-subscription";
import { subscribeToTeacherCourseSubscriptions } from "@/lib/data/course-subscriptions";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";

type ReadState = "loading" | "ready" | "error";

function money(amountMinor: number, currency: string): string {
  try {
    const formatted = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amountMinor / 100);
    return `${currency} ${formatted}`;
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function moneyBreakdown(values: CurrencyAmount[]): string {
  if (!values.length) return "No activity";
  return values.map((value) => money(value.amountMinor, value.currency)).join(" + ");
}

function unavailableValue(state: ReadState): string {
  return state === "error" ? "Unavailable" : "—";
}

export function CreatorOpsHub() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledgers, setLedgers] = useState<PayoutLedgerEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<CourseSubscription[]>([]);
  const [ordersState, setOrdersState] = useState<ReadState>("loading");
  const [ledgersState, setLedgersState] = useState<ReadState>("loading");
  const [subscriptionsState, setSubscriptionsState] =
    useState<ReadState>("loading");

  useEffect(() => {
    if (!user) return;
    const unsubs = [
      subscribeToTeacherOrders(
        user.uid,
        (next) => {
          setOrders(next);
          setOrdersState("ready");
        },
        () => setOrdersState("error"),
      ),
      subscribeToTeacherPayoutLedger(
        user.uid,
        (next) => {
          setLedgers(next);
          setLedgersState("ready");
        },
        () => setLedgersState("error"),
      ),
      subscribeToTeacherCourseSubscriptions(
        user.uid,
        (next) => {
          setSubscriptions(next);
          setSubscriptionsState("ready");
        },
        () => setSubscriptionsState("error"),
      ),
    ];
    return () => {
      for (const unsub of unsubs) unsub?.();
    };
  }, [user]);

  const snap = useMemo(() => {
    const subscriptionMetrics = calculateCreatorSubscriptionMetrics(
      subscriptions,
      [],
      undefined,
      { orders, ledgers },
    );
    return buildCreatorOpsSnapshot({
      orders,
      ledgers,
      subscriptionMetrics,
    });
  }, [orders, ledgers, subscriptions]);

  const financialFallbackState: ReadState =
    ordersState === "error" && ledgersState === "error"
      ? "error"
      : ordersState === "ready" || ledgersState === "ready"
        ? "ready"
        : "loading";
  const mrrState: ReadState =
    subscriptionsState !== "ready"
      ? subscriptionsState
      : snap.mrrSnapshotMissingCount === 0
        ? "ready"
        : financialFallbackState;
  const mrrDetail = mrrState === "ready"
    ? [
        `${moneyBreakdown(snap.mrrByCurrency)} MRR`,
        `${snap.pastDueSubscribers} past due`,
        snap.mrrLegacyFallbackCount > 0
          ? `${snap.mrrLegacyFallbackCount} legacy invoice fallback`
          : null,
        snap.mrrSnapshotMissingCount > 0
          ? `${snap.mrrSnapshotMissingCount} contract snapshot missing`
          : null,
      ].filter(Boolean).join(" · ")
    : mrrState === "error"
      ? "Recurring revenue could not be loaded"
      : "Loading recurring revenue";

  const cards = [
    {
      href: "/teach/sales",
      label: "Sales",
      value: ordersState === "ready"
        ? String(snap.salesCount)
        : unavailableValue(ordersState),
      detail: ordersState === "ready"
        ? moneyBreakdown(snap.salesGrossByCurrency)
        : ordersState === "error"
          ? "Sales data could not be loaded"
          : "Loading sales",
      icon: BadgeDollarSign,
    },
    {
      href: "/teach/subscriptions",
      label: "Subscribers",
      value: subscriptionsState === "ready"
        ? String(snap.activeSubscribers)
        : unavailableValue(subscriptionsState),
      detail: mrrDetail,
      icon: Repeat2,
    },
    {
      href: "/account/payments",
      label: "Earnings recorded",
      value: ledgersState === "ready"
        ? moneyBreakdown(snap.teacherNetByCurrency)
        : unavailableValue(ledgersState),
      detail: ledgersState === "ready"
        ? "Recorded on your own Stripe account, not ours"
        : ledgersState === "error"
          ? "Earnings record could not be loaded"
          : "Loading earnings record",
      icon: Wallet,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition hover:border-[var(--color-primary)]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  {card.label}
                </span>
                <Icon className="h-4 w-4 text-[var(--color-ink-soft)]" />
              </div>
              <div className="text-2xl font-semibold text-[var(--color-ink)]">
                {card.value}
              </div>
              <div className="mt-1 flex items-start gap-1 text-sm text-[var(--color-ink-soft)]">
                <span className="min-w-0 break-words">{card.detail}</span>
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          Operations shortcuts
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { href: "/teach/sales", label: "All sales" },
            { href: "/teach/subscriptions", label: "Subscriptions" },
            { href: "/account/payments", label: "Earnings & Connect" },
            { href: "/teach/coupons", label: "Coupons" },
            { href: "/teach/builder", label: "Course builder" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-primary)]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
