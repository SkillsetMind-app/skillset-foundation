"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { RevenueChart } from "@/components/teacher/revenue-chart";
import {
  buildCreatorOpsSnapshot,
  type CurrencyAmount,
} from "@/domain/creator-ops";
import {
  buildReportProductRows,
  buildRevenueSeries,
  calculateRefundRate,
  isWithinWindow,
  resolveReportWindow,
  type ReportPeriod,
} from "@/domain/creator-reports";
import { calculateCreatorSubscriptionMetrics } from "@/domain/creator-subscriptions";
import { isPaidOrder, type Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { CourseSubscription } from "@/domain/course-subscription";
import { subscribeToTeacherCourseSubscriptions } from "@/lib/data/course-subscriptions";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";

type ReadState = "loading" | "ready" | "error";

const periods: ReportPeriod[] = ["7d", "30d", "90d", "12m", "all"];

const periodSubtitleKey: Record<ReportPeriod, string> = {
  "7d": "teach.reports.range7d",
  "30d": "teach.reports.range30d",
  "90d": "teach.reports.range90d",
  "12m": "teach.insights.range12m",
  all: "teach.insights.rangeAll",
};

function money(amountMinor: number, currency: string, locale: string): string {
  try {
    const formatted = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(amountMinor / 100);
    return `${currency} ${formatted}`;
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function CreatorOpsHub() {
  const { user } = useAuth();
  const { locale, t } = useTranslation();
  const chartMoney = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledgers, setLedgers] = useState<PayoutLedgerEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<CourseSubscription[]>([]);
  const [ordersState, setOrdersState] = useState<ReadState>("loading");
  const [ledgersState, setLedgersState] = useState<ReadState>("loading");
  const [subscriptionsState, setSubscriptionsState] =
    useState<ReadState>("loading");
  const [period, setPeriod] = useState<ReportPeriod>("30d");

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

  const moneyBreakdown = (values: CurrencyAmount[]): string =>
    values.length
      ? values.map((value) => money(value.amountMinor, value.currency, locale)).join(" + ")
      : t("teach.reports.noActivity");

  const report = useMemo(() => {
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
    const dayFormatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    });
    const paidOrders = orders.filter((order) => isPaidOrder(order.status));
    // A janela sai dos pedidos pagos porque "All" precisa saber onde a loja
    // comecou; os KPIs e o grafico usam a MESMA janela, entao a linha e o
    // numero nunca contam periodos diferentes.
    const window = resolveReportWindow(paidOrders, period);
    const ordersInPeriod = orders.filter((order) =>
      isWithinWindow(order.createdAt, window),
    );
    const ledgersInPeriod = ledgers.filter((entry) =>
      isWithinWindow(entry.createdAt, window),
    );
    // MRR e uma foto de hoje, nao um acumulado: ele le a carteira inteira.
    const subscriptionMetrics = calculateCreatorSubscriptionMetrics(
      subscriptions,
      [],
      undefined,
      { orders, ledgers },
    );

    return {
      snap: buildCreatorOpsSnapshot({
        orders: ordersInPeriod,
        ledgers: ledgersInPeriod,
        subscriptionMetrics,
      }),
      refund: calculateRefundRate(ordersInPeriod),
      series: buildRevenueSeries(
        paidOrders.filter((order) => isWithinWindow(order.createdAt, window)),
        window,
        (date, bucket) =>
          bucket === "month"
            ? monthFormatter.format(date)
            : dayFormatter.format(date),
      ),
      products: buildReportProductRows(ordersInPeriod),
    };
  }, [orders, ledgers, subscriptions, period, locale]);

  const { snap, refund, series, products } = report;
  const chartTotalMinor = series.reduce((sum, point) => sum + point.grossMinor, 0);

  const columns = {
    product: t("teach.reports.colProduct"),
    orders: t("teach.reports.colOrders"),
    revenue: t("teach.reports.colRevenue"),
    refunds: t("teach.reports.colRefunds"),
  };
  const exportRows = products.map((row) => ({
    [columns.product]: row.courseTitle,
    [columns.orders]: row.orders,
    [columns.revenue]: (row.grossMinor / 100).toFixed(2),
    [t("teach.reports.colCurrency")]: row.currency,
    [columns.refunds]: row.refunds,
  }));

  function tileValue(state: ReadState, value: string): string {
    if (state === "ready") return value;
    return state === "error"
      ? t("teach.reports.unavailable")
      : t("teach.reports.loadingValue");
  }

  const tiles = [
    {
      key: "sales",
      label: t("teach.reports.kpiSales"),
      value: tileValue(ordersState, String(snap.salesCount)),
      detail:
        ordersState === "ready"
          ? moneyBreakdown(snap.salesGrossByCurrency)
          : t("teach.reports.kpiSalesDetail"),
    },
    {
      key: "net",
      label: t("teach.reports.kpiNet"),
      value: tileValue(ledgersState, moneyBreakdown(snap.teacherNetByCurrency)),
      detail: t("teach.reports.kpiNetDetail"),
    },
    {
      key: "refund",
      label: t("teach.reports.kpiRefund"),
      value: tileValue(ordersState, `${refund.rate}%`),
      detail: t("teach.reports.kpiRefundDetail")
        .replace("{refunded}", () => String(refund.refundedCount))
        .replace("{collected}", () => String(refund.collectedCount)),
    },
    {
      key: "mrr",
      label: t("teach.reports.kpiMrr"),
      value: tileValue(subscriptionsState, moneyBreakdown(snap.mrrByCurrency)),
      detail: t("teach.reports.kpiMrrDetail"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs
          options={periods}
          value={period}
          onChange={setPeriod}
          label={t("teach.reports.periodLabel")}
          renderLabel={(option) =>
            option === "all" ? t("teach.insights.rangeAllTab") : option
          }
        />
        <ExportTableButton rows={exportRows} filename="skillset-reports" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <article
            key={tile.key}
            className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-soft)]"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
              {tile.label}
            </span>
            <div className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
              {tile.value}
            </div>
            <p className="mt-1 text-sm leading-5 text-[var(--color-ink-soft)]">
              {tile.detail}
            </p>
          </article>
        ))}
      </div>

      <RevenueChart
        points={series}
        totalMinor={chartTotalMinor}
        totalLabel={chartMoney.format(chartTotalMinor / 100)}
        title={t("teach.insights.revenue")}
        subtitle={t(periodSubtitleKey[period])}
        ariaLabel={t("teach.insights.chartAria")}
        emptyTitle={t("teach.reports.noRevenueInPeriod")}
        emptyDetail={t("teach.reports.noRevenueInPeriodDetail")}
      />

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("teach.reports.byProduct")}
        </h2>
        {products.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  <th className="pb-2 pr-4 font-semibold">{columns.product}</th>
                  <th className="pb-2 pr-4 text-right font-semibold">
                    {columns.orders}
                  </th>
                  <th className="pb-2 pr-4 text-right font-semibold">
                    {columns.revenue}
                  </th>
                  <th className="pb-2 text-right font-semibold">
                    {columns.refunds}
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr
                    key={row.courseId}
                    className="border-t border-[var(--color-line)] text-[var(--color-ink)]"
                  >
                    <td className="py-2 pr-4">{row.courseTitle}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.orders}
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                      {money(row.grossMinor, row.currency, locale)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{row.refunds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            {t("teach.reports.byProductEmpty")}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("teach.reports.shortcuts")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { href: "/teach/sales", label: t("teach.reports.linkSales") },
            {
              href: "/teach/subscriptions",
              label: t("teach.reports.linkSubscriptions"),
            },
            {
              href: "/account/payments",
              label: t("teach.reports.linkEarnings"),
            },
            { href: "/teach/coupons", label: t("teach.reports.linkCoupons") },
            { href: "/teach/builder", label: t("teach.reports.linkBuilder") },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-primary)]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
