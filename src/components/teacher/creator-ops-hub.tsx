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
import { buildCreatorOpsSnapshot } from "@/domain/creator-ops";
import { calculateCreatorSubscriptionMetrics } from "@/domain/creator-subscriptions";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { CourseSubscription } from "@/domain/course-subscription";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourseSubscriptions } from "@/lib/data/course-subscriptions";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

function money(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

export function CreatorOpsHub() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledgers, setLedgers] = useState<PayoutLedgerEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<CourseSubscription[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubs = [
      subscribeToTeacherOrders(user.uid, setOrders, () => setOrders([])),
      subscribeToTeacherPayoutLedger(user.uid, setLedgers, () => setLedgers([])),
      subscribeToTeacherCourseSubscriptions(
        user.uid,
        setSubscriptions,
        () => setSubscriptions([]),
      ),
      subscribeToTeacherCourses(user.uid, setCourses, () => setCourses([])),
    ];
    return () => {
      for (const unsub of unsubs) unsub?.();
    };
  }, [user]);

  const snap = useMemo(() => {
    const subscriptionMetrics = calculateCreatorSubscriptionMetrics(
      subscriptions,
      courses,
    );
    return buildCreatorOpsSnapshot({
      orders,
      ledgers,
      subscriptionMetrics,
    });
  }, [orders, ledgers, subscriptions, courses]);

  const cards = [
    {
      href: "/teach/sales",
      label: "Sales",
      value: String(snap.salesCount),
      detail: money(snap.salesGrossMinor, snap.salesCurrency),
      icon: BadgeDollarSign,
    },
    {
      href: "/teach/subscriptions",
      label: "Subscribers",
      value: String(snap.activeSubscribers),
      detail: `${money(snap.mrrMinor, snap.mrrCurrency)} MRR · ${snap.pastDueSubscribers} past due`,
      icon: Repeat2,
    },
    {
      href: "/account/payments",
      label: "Wallet",
      value: money(snap.walletReleasedMinor, snap.salesCurrency),
      detail: `${money(snap.walletInReleaseMinor, snap.salesCurrency)} in release`,
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
              <div className="mt-1 flex items-center gap-1 text-sm text-[var(--color-ink-soft)]">
                {card.detail}
                <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
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
            { href: "/account/payments", label: "Wallet & Connect" },
            { href: "/teach/refunds", label: "Refunds" },
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
