"use client";

import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { InlineAlert } from "@/components/ui";
import type { Order } from "@/domain/order";
import { subscribeToRecentOrders } from "@/lib/data/orders";

function formatMoney(amountMinor: number, currency: Order["currency"], locale = "en") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function PaymentOperationsPanel() {
  const { t, locale } = useTranslation();
  const copy = "platform.ops.paymentsPanel";
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    return subscribeToRecentOrders(
      (nextOrders) => {
        setOrders(nextOrders);
        setError(false);
        setIsLoading(false);
      },
      () => {
        setError(true);
        setIsLoading(false);
      },
    );
  }, []);

  // Somar BRL com EUR e rotular o resultado como USD produz um número que não
  // existe — e era exibido como "receita da plataforma". Agora acumula por
  // moeda e cada uma é formatada na sua própria.
  const totals = useMemo(() => {
    const byCurrency = new Map<
      Order["currency"],
      { grossMinor: number; feeMinor: number }
    >();

    const summary = orders.reduce(
      (acc, order) => {
        if (order.status === "paid") {
          acc.paid += 1;
          const bucket = byCurrency.get(order.currency) ?? {
            grossMinor: 0,
            feeMinor: 0,
          };
          bucket.grossMinor += order.amountMinor;
          bucket.feeMinor += Math.floor(
            (order.amountMinor * order.platformFeeBps) / 10000,
          );
          byCurrency.set(order.currency, bucket);
        }

        if (order.status === "refunded" || order.status === "partially_refunded") {
          acc.refunds += 1;
        }

        return acc;
      },
      { paid: 0, refunds: 0 },
    );

    const currencies = [...byCurrency.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    return {
      ...summary,
      gross: currencies.length
        ? currencies
            .map(([currency, v]) => formatMoney(v.grossMinor, currency, locale))
            .join(" · ")
        : "—",
      fee: currencies.length
        ? currencies
            .map(([currency, v]) => formatMoney(v.feeMinor, currency, locale))
            .join(" · ")
        : "—",
    };
  }, [orders, locale]);
  // Exports keep their existing English money representation in every locale.
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
            {t("platform.ops.payments")}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportTableButton filename="skillset-orders" rows={exportRows} disabled={isLoading || error} />
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            {t(`${copy}.adminOnly`)}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          // subscribeToRecentOrders usa .limit(12): estes números descrevem a
          // amostra visível, não a plataforma. Rotulados como "Gross paid" eram
          // lidos como receita total — errado por ordem de grandeza assim que
          // houver mais de 12 vendas.
          [t(`${copy}.paidSample`), String(totals.paid)],
          [t(`${copy}.grossSample`), totals.gross],
          [t(`${copy}.feeSample`), totals.fee],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
              {label}
            </p>
            <p className="mt-2 break-words text-lg font-bold text-[var(--color-primary)]">
              {isLoading ? t(`${copy}.loadingValue`) : error ? t(`${copy}.unavailable`) : value}
            </p>
          </div>
        ))}
      </div>

      {error ? (
        <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t(`${copy}.loading`)}</p>
        ) : orders.length === 0 ? (
          error ? null : <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
        ) : (
          orders.map((order) => (
            <article
              key={order.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <StatusChip status={order.status} />
                  <h4 className="mt-2 break-words text-base font-semibold text-[var(--color-ink)]">
                    {order.courseTitle}
                  </h4>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1 text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency, locale)}
                </span>
              </div>
              <p className="mt-3 break-words text-xs leading-6 text-[var(--color-ink-soft)]">
                {t(`${copy}.order`)} {order.id} - {t(`${copy}.user`)} {order.userId} - {t(`${copy}.provider`)} {order.provider}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
