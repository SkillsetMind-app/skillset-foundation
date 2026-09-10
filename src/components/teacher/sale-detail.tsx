"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Locale } from "@/lib/i18n/config";
import { Copy, Mail, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { buttonClasses, Card, Eyebrow, InlineAlert } from "@/components/ui";
import type { Order } from "@/domain/order";
import { subscribeToOrder } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";

type SaleDetailProps = {
  orderId: string;
};

function formatMoney(amountMinor: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatOrderRef(id: string) {
  const tail = id.slice(-8).toUpperCase();
  return tail ? `#${tail}` : `#${id.toUpperCase()}`;
}

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
      className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)]"
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
  }, [orderId]);

  if (isLoading) {
    return (
      <section className="settings-section-card">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("saleDetail.loading")}</p>
      </section>
    );
  }

  if (error || !order) {
    return (
      <section className="settings-section-card">
        <InlineAlert tone="error">{t(error || "saleDetail.notFound")}</InlineAlert>
        <Link
          href="/teach"
          className={buttonClasses({ variant: "outline" }, "mt-5")}
        >
          {t("saleDetail.back")}
        </Link>
      </section>
    );
  }

  const canView =
    user?.roles.includes("admin") || user?.uid === order.teacherId || user?.uid === order.userId;
  const platformFeeMinor = Math.floor((order.amountMinor * order.platformFeeBps) / 10000);
  const creatorNetMinor = order.amountMinor - platformFeeMinor;
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
      <div className="grid gap-5">
        <section className="settings-section-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Eyebrow>{t("saleDetail.sale")}</Eyebrow>
              <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
                {t("saleDetail.order").replace("{id}", () => formatOrderRef(order.id))}
              </h2>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-6 text-[var(--color-ink-soft)]">
                {t("saleDetail.fullId")}
                <CopyIdButton value={order.id} label={t("saleDetail.orderId")} />
              </p>
              <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
                {t("saleDetail.dates")
                  .replace("{created}", () => formatDate(order.createdAt, locale, t("saleDetail.pendingTime")))
                  .replace("{updated}", () => formatDate(order.updatedAt ?? order.createdAt, locale, t("saleDetail.pendingTime")))}
              </p>
            </div>
            <StatusChip status={order.status} />
          </div>
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
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              [t("saleDetail.amount"), formatMoney(order.amountMinor, order.currency, locale)],
              [t("saleDetail.fee"), formatMoney(platformFeeMinor, order.currency, locale)],
              [t("saleDetail.net"), formatMoney(creatorNetMinor, order.currency, locale)],
            ].map(([label, value]) => (
              <Card key={label} tone="soft" padding="sm" shadow={false}>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                  {label}
                </p>
                <p className="mt-2 text-lg font-bold text-[var(--color-primary)]">
                  {value}
                </p>
              </Card>
            ))}
          </div>
          <Card
            padding="sm"
            shadow={false}
            className="mt-5 grid gap-3 text-xs text-[var(--color-ink-soft)]"
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

        <section className="settings-section-card">
          <Eyebrow>{t("saleDetail.actions")}</Eyebrow>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={`/learn/courses/${order.courseSlug}`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {t("saleDetail.viewEnrollment")}
            </Link>
            <a
              href="mailto:support@skillsetmind.com"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              <Mail aria-hidden="true" size={14} />
              {t("saleDetail.support")}
            </a>
            <a
              href={`mailto:support@skillsetmind.com?subject=${encodeURIComponent(
                t("saleDetail.refundSubject").replace("{id}", () => order.id),
              )}&body=${encodeURIComponent(
                t("saleDetail.refundBody").replace(/\{id\}|\{title\}/g, (token) => token === "{id}" ? order.id : order.courseTitle),
              )}`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              <RotateCcw aria-hidden="true" size={14} />
              {t("saleDetail.refund")}
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
          <div className="mt-4 grid gap-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            <p>{t("saleDetail.courseId")} {order.courseId}</p>
            <p>{t("saleDetail.slug")} {order.courseSlug}</p>
            <p>{t("saleDetail.currency")} {order.currency}</p>
          </div>
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
