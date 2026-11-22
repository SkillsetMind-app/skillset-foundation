"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { InlineAlert } from "@/components/ui";
import type { Order } from "@/domain/order";
import { subscribeToRecentOrders } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";
import { platformFeeForSale } from "@/lib/payments/rules";

function formatMoney(amountMinor: number, currency: Order["currency"], locale = "en") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

// Quando o dinheiro entrou; sem pagamento ainda, quando o pedido nasceu.
function formatOrderDate(order: Order, locale: string) {
  const date = toDate(order.paidAt) ?? toDate(order.createdAt);
  return date ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}

// Os 8 primeiros caracteres bastam para conferir de olho; o código inteiro fica no title.
function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
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
          bucket.feeMinor += platformFeeForSale(
            order.amountMinor,
            order.platformFeeBps,
            order.platformFeeFixedMinor ?? 0,
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
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportTableButton filename="skillset-orders" rows={exportRows} disabled={isLoading || error} />
          <span className="rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
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
            className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
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
          error ? null : <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
        ) : (
          orders.map((order) => (
            <article
              key={order.id}
              className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <StatusChip status={order.status} />
                  <h4 className="mt-2 break-words text-base font-semibold text-[var(--color-ink)]">
                    {order.courseTitle}
                  </h4>
                </div>
                <span className="rounded-md bg-white px-3 py-1 text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency, locale)}
                </span>
              </div>
              {/* Em partes com rótulo, não numa linha corrida: a data do pedido
                  (nunca aparecia) e os códigos curtos, inteiros no title. O
                  comprador abre a ficha da pessoa (I-06). */}
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-6 text-[var(--color-ink-soft)]">
                <div className="flex gap-1.5">
                  <dt>{t(`${copy}.date`)}</dt>
                  <dd className="tabular-nums text-[var(--color-ink)]">{formatOrderDate(order, locale)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>{t(`${copy}.user`)}</dt>
                  <dd>
                    <Link href={`/ops/users/${encodeURIComponent(order.userId)}`} title={order.userId} aria-label={order.userId}
                      className="font-mono font-semibold text-[var(--color-primary)] underline underline-offset-2">
                      {shortId(order.userId)}
                    </Link>
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>{t(`${copy}.order`)}</dt>
                  <dd className="font-mono text-[var(--color-ink)]" title={order.id}>{shortId(order.id)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>{t(`${copy}.provider`)}</dt>
                  <dd className="text-[var(--color-ink)]">{order.provider}</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
