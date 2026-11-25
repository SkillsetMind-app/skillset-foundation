"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Locale } from "@/lib/i18n/config";
import { ArrowLeft, Copy, Mail, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { SaleDetailSkeleton } from "@/components/teacher/builder-skeleton";
import { StripeDashboardButton } from "@/components/teacher/stripe-dashboard-button";
import { SupportDetails } from "@/components/teacher/support-details";
import { buttonClasses, Card, Eyebrow, InlineAlert } from "@/components/ui";
import { formatOrderRef, orderRevenueMinor, type Order } from "@/domain/order";
import { subscribeToOrder } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/format-money";
import { platformFeeForSale } from "@/lib/payments/rules";

const textLink =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4";

type SaleDetailProps = {
  orderId: string;
};

function formatDate(value: unknown, locale: Locale, pending: string) {
  const date = toDate(value);
  if (!date) {
    return pending;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function CopyIdButton({ value, label }: { value: string | null; label: string }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  if (!value) {
    return <span className="text-[var(--color-ink-muted)]">{t("saleDetail.unavailable")}</span>;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value ?? "");
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <>
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)]"
      aria-label={t("saleDetail.copy").replace("{label}", () => label)}
    >
      <Copy aria-hidden="true" size={13} strokeWidth={1.9} />
      {copyState === "copied" ? t("saleDetail.copied") : value}
    </button>
    {copyState === "failed" ? <span role="alert">{t("saleDetail.copyError")}</span> : null}
    </>
  );
}

function getTimeline(order: Order, t: (key: string) => string, locale: Locale) {
  const items = [
    {
      label: t("saleDetail.orderCreated"),
      detail: t("saleDetail.orderCreatedDetail"),
      time: formatDate(order.createdAt, locale, t("saleDetail.pendingTime")),
    },
  ];

  if (order.checkoutSessionId) {
    items.push({
      label: t("saleDetail.checkoutCreated"),
      detail: t("saleDetail.sessionDetail").replace("{id}", () => order.checkoutSessionId!),
      time: formatDate(order.createdAt, locale, t("saleDetail.pendingTime")),
    });
  }

  if (order.paymentIntentId) {
    items.push({
      label: order.status === "paid" ? t("saleDetail.paymentSucceeded") : t("saleDetail.intentRecorded"),
      detail: t("saleDetail.intentDetail").replace("{id}", () => order.paymentIntentId!),
      time: formatDate(order.updatedAt ?? order.createdAt, locale, t("saleDetail.pendingTime")),
    });
  }

  if (order.status === "paid") {
    items.push({
      label: t("saleDetail.enrollmentActivated"),
      detail: t("saleDetail.accessOpen"),
      time: formatDate(order.updatedAt ?? order.createdAt, locale, t("saleDetail.pendingTime")),
    });
    items.push({
      label: t("saleDetail.chargeCreated"),
      detail:
        t("saleDetail.chargeDetail"),
      time: formatDate(order.updatedAt ?? order.createdAt, locale, t("saleDetail.pendingTime")),
    });
  }

  if (order.status === "refunded" || order.status === "partially_refunded") {
    items.push({
      label: t("saleDetail.refundRecorded"),
      detail: t("saleDetail.refundDetail"),
      time: formatDate(order.updatedAt ?? order.createdAt, locale, t("saleDetail.pendingTime")),
    });
  }

  return items;
}

export function SaleDetail({ orderId }: SaleDetailProps) {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // "Try again" subscribes to the same read again (before, the only way out was reloading).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    return subscribeToOrder(
      orderId,
      (nextOrder) => {
        setOrder(nextOrder);
        setIsLoading(false);
      },
      () => {
        setError("saleDetail.loadError");
        setIsLoading(false);
      },
    );
  }, [orderId, attempt]);

  if (isLoading) {
    return <SaleDetailSkeleton label={t("saleDetail.loading")} />;
  }

  if (error || !order) {
    return (
      <section className="settings-section-card">
        <InlineAlert tone="error">{t(error || "saleDetail.notFound")}</InlineAlert>
        <div className="mt-5 flex flex-wrap gap-3">
          {/* Only a read failure retries; a sale that does not exist does not. */}
          {error ? (
            <button
              type="button"
              onClick={() => {
                setError("");
                setIsLoading(true);
                setAttempt((current) => current + 1);
              }}
              className={buttonClasses({ variant: "outline" })}
            >
              {t("appErrors.retry")}
            </button>
          ) : null}
          <Link href="/teach/sales" className={buttonClasses({ variant: "outline" })}>
            {t("saleDetail.back")}
          </Link>
        </div>
      </section>
    );
  }

  const canView =
    user?.roles.includes("admin") || user?.uid === order.teacherId || user?.uid === order.userId;
  const isOwnSale = Boolean(user && user.uid === order.teacherId && user.roles.includes("teacher"));
  // Same formula the checkout charged: percent + the order's fixed part.
  const platformFeeMinor = platformFeeForSale(
    order.amountMinor,
    order.platformFeeBps,
    order.platformFeeFixedMinor ?? 0,
  );
  const creatorNetMinor = order.amountMinor - platformFeeMinor;
  const refundedMinor = order.refundedAmountMinor ?? 0;
  // The big number is what the teacher kept, the same calculation as Earnings
  // (orderRevenueMinor: amount minus what was returned). Fully refunded,
  // pending, failed or canceled is not revenue: no big number, only the three
  // small values, as before.
  // The fee stays AS CHARGED, on the full amount at checkout. A
  // refund through SkillsetMind (refund_application_fee) returns the fee
  // proportionally, but the order does not store how much came back (and a refund made
  // directly in Stripe may not return it): the net shown is the floor, never
  // more than what was kept.
  const keptMinor = orderRevenueMinor(order);
  const headlineMinor = keptMinor === null ? null : keptMinor - platformFeeMinor;
  const money = (amountMinor: number) => formatMoney(amountMinor, order.currency, locale);
  const figures: Array<[string, string]> = [[t("saleDetail.amount"), money(order.amountMinor)]];
  if (refundedMinor > 0) figures.push([t("saleDetail.refunded"), `−${money(refundedMinor)}`]);
  figures.push([t("saleDetail.fee"), money(platformFeeMinor)]);
  if (headlineMinor === null) figures.push([t("saleDetail.net"), money(creatorNetMinor)]);
  const timeline = getTimeline(order, t, locale);

  if (!canView) {
    return (
      <section className="settings-section-card">
        <InlineAlert tone="error">
          {t("saleDetail.denied")}
        </InlineAlert>
      </section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* There was no way back to Sales: only the menu, or Home on error. */}
      <Link
        href="/teach/sales"
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-[var(--color-primary)] hover:underline lg:col-span-2"
      >
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.9} />
        {t("saleDetail.back")}
      </Link>
      <div className="grid gap-5">
        {/* What the teacher receives is the big number; the order code
            was the largest text on the screen (36px serif) and the net amount the smallest. */}
        <section className="settings-section-card">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-[var(--color-ink-soft)]">
              {t("saleDetail.order").replace("{id}", () => formatOrderRef(order.id))}
            </h2>
            <StatusChip status={order.status} />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
            {headlineMinor !== null ? (
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                  {t(refundedMinor > 0 ? "saleDetail.netAfterRefund" : "saleDetail.net")}
                </p>
                <p className="num mt-1 text-3xl font-bold text-[var(--color-primary)]">
                  {money(headlineMinor)}
                </p>
              </div>
            ) : null}
            <div className="grid gap-1 text-sm">
              {figures.map(([label, value]) => (
                <div key={label} className="flex flex-wrap gap-x-2">
                  <p className="text-[var(--color-ink-soft)]">{label}</p>
                  <p className="num font-semibold text-[var(--color-ink)]">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs leading-6 text-[var(--color-ink-soft)]">
            {t("saleDetail.fullId")}
            <CopyIdButton value={order.id} label={t("saleDetail.orderId")} />
          </p>
          <p className="mt-2 text-xs leading-6 text-[var(--color-ink-soft)]">
            {t("saleDetail.dates")
              .replace("{created}", () => formatDate(order.createdAt, locale, t("saleDetail.pendingTime")))
              .replace("{updated}", () => formatDate(order.updatedAt ?? order.createdAt, locale, t("saleDetail.pendingTime")))}
          </p>
        </section>

        <section className="settings-section-card">
          <Eyebrow>{t("saleDetail.customer")}</Eyebrow>
          <Card tone="soft" padding="sm" shadow={false} className="mt-4">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("saleDetail.learner")}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("saleDetail.accountId")}
              <CopyIdButton value={order.userId} label={t("saleDetail.learnerId")} />
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("saleDetail.customerHelp")}
            </p>
          </Card>
        </section>

        <section className="settings-section-card">
          <Eyebrow>{t("saleDetail.payment")}</Eyebrow>
          <Card
            padding="sm"
            shadow={false}
            className="mt-4 grid gap-3 text-xs text-[var(--color-ink-soft)]"
          >
            <p>
              {t("saleDetail.provider")} <strong className="text-[var(--color-ink)]">{order.provider}</strong>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              {t("saleDetail.intent")}
              <CopyIdButton value={order.paymentIntentId} label={t("saleDetail.intentId")} />
            </p>
            <p className="flex flex-wrap items-center gap-2">
              {t("saleDetail.session")}
              <CopyIdButton value={order.checkoutSessionId} label={t("saleDetail.sessionId")} />
            </p>
          </Card>
        </section>

        <section className="settings-section-card">
          <Eyebrow>{t("saleDetail.timeline")}</Eyebrow>
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

        <section id="sale-refund" className="settings-section-card scroll-mt-24">
          <Eyebrow>{t("saleDetail.actions")}</Eyebrow>
          {isOwnSale ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("stripeDashboard.refundGuidance")}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {isOwnSale ? <StripeDashboardButton /> : null}
            <Link
              href={`/learn/courses/${order.courseSlug}`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {t("saleDetail.viewEnrollment")}
            </Link>
            {/* The two support emails are text links: they used to be four
                identical buttons, and the two that open the email looked like actions on the
                sale. */}
            <a href="mailto:support@skillsetmind.com" className={textLink}>
              <Mail aria-hidden="true" size={14} />
              {t("saleDetail.support")}
            </a>
            <a
              href={`mailto:support@skillsetmind.com?subject=${encodeURIComponent(
                t("saleDetail.refundSubject").replace("{id}", () => order.id),
              )}&body=${encodeURIComponent(
                t("saleDetail.refundBody").replace(/\{id\}|\{title\}/g, (token) => token === "{id}" ? order.id : order.courseTitle),
              )}`}
              className={textLink}
            >
              <RotateCcw aria-hidden="true" size={14} />
              {t(isOwnSale ? "stripeDashboard.refundSupport" : "saleDetail.refund")}
            </a>
          </div>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="settings-section-card">
          <Eyebrow>{t("saleDetail.course")}</Eyebrow>
          <h3 className="mt-3 text-lg font-bold leading-7 text-[var(--color-ink)]">
            {order.courseTitle}
          </h3>
          {/* Code, slug and currency are only useful to support: collapsed, and
              still selectable to paste into a ticket. */}
          <SupportDetails className="mt-3">
            <p>{t("saleDetail.courseId")} {order.courseId}</p>
            <p>{t("saleDetail.slug")} {order.courseSlug}</p>
            <p>{t("saleDetail.currency")} {order.currency}</p>
          </SupportDetails>
          <Link
            href={`/courses/${order.courseSlug}`}
            className={buttonClasses({ variant: "outline", size: "sm" }, "mt-5")}
          >
            {t("saleDetail.publicCourse")}
          </Link>
        </section>      </aside>
    </div>
  );
}
