"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Card, InlineAlert, buttonClasses } from "@/components/ui";
import type { Order } from "@/domain/order";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";

// A moldura de operacao (periodo, busca, status, exportar) e desenhada com ou
// sem pedidos. Antes, zero pedidos trocava a pagina inteira por um card de
// vazio: a pessoa nao sabia se "nenhuma venda" era nenhuma venda NUNCA ou
// nenhuma venda nos ultimos 30 dias, porque nao havia periodo nenhum na tela.

const copy = "creatorPanel.sales";

const PERIODS = ["7d", "30d", "90d", "12m", "all"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};

const STATUS_FILTERS = ["all", "paid", "refunded"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STRIPE_PAYMENTS_URL = "https://dashboard.stripe.com/payments";

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatDate(value: Date | null, locale: string, fallback: string) {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value);
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

/**
 * Deep link para o pagamento na Dashboard da Stripe do proprio criador. A
 * cobranca nasce na conta conectada dele, entao o reembolso acontece la — nao
 * ha nada para a SkillsetMind estornar. Pedido sem payment intent (pendente,
 * falho, ou anterior a captura do id) cai na lista de pagamentos.
 */
function stripeRefundUrl(order: Order) {
  return order.paymentIntentId
    ? `${STRIPE_PAYMENTS_URL}/${order.paymentIntentId}`
    : STRIPE_PAYMENTS_URL;
}

const PAGE = 50;

export function SaleList() {
  const { user } = useAuth();
  const { locale, t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<Period>("30d");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  // subscribeToTeacherOrders already pages through every order, so the client
  // holds the full set and sale 51+ was unreachable purely because the render
  // sliced at 50. Growing a window costs one number; a real paginated query
  // would cost a round trip we do not need.
  const [visibleCount, setVisibleCount] = useState(PAGE);

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
        setError(true);
        setIsLoading(false);
      },
    );
  }, [user]);

  const range = useMemo(() => {
    if (period === "all") {
      return null;
    }

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - PERIOD_DAYS[period]);
    return { from, to };
  }, [period]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const fromMs = range?.from.getTime() ?? 0;

    return orders
      .filter((order) => {
        const createdMs = toMillis(order.createdAt);
        // createdMs === 0 e data ausente: nao escondemos o pedido por isso.
        if (createdMs && createdMs < fromMs) {
          return false;
        }
        if (status === "paid" && order.status !== "paid") {
          return false;
        }
        if (
          status === "refunded" &&
          order.status !== "refunded" &&
          order.status !== "partially_refunded"
        ) {
          return false;
        }
        if (!needle) {
          return true;
        }
        return `${order.courseTitle} ${order.id}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [orders, range, search, status]);

  const exportRows = useMemo(
    () =>
      visible.map((order) => ({
        order_id: order.id,
        created_at: toDate(order.createdAt)?.toISOString() ?? "",
        course: order.courseTitle,
        status: order.status,
        amount_minor: order.amountMinor,
        refunded_amount_minor: order.refundedAmountMinor ?? 0,
        currency: order.currency,
        payment_intent_id: order.paymentIntentId ?? "",
      })),
    [visible],
  );

  if (isLoading) {
    return (
      <Card as="section" padding="lg">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {t(`${copy}.loading`)}
        </p>
      </Card>
    );
  }

  if (error) {
    // Era uma caixa vermelha muda: a lista sumia, aparecia vermelho, e nada
    // era anunciado.
    return (
      <InlineAlert tone="error" className="p-6">
        {t(`${copy}.error`)}
      </InlineAlert>
    );
  }

  const visibleOrders = visible.slice(0, visibleCount);
  const hiddenCount = visible.length - visibleOrders.length;
  const countKey = range
    ? visible.length === 1
      ? "countOne"
      : "count"
    : visible.length === 1
      ? "countAllOne"
      : "countAll";
  const countLine = t(`${copy}.${countKey}`)
    .replace("{count}", () => String(visible.length))
    .replace("{from}", () => formatDate(range?.from ?? null, locale, ""))
    .replace("{to}", () => formatDate(range?.to ?? null, locale, ""));

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="sales-period" className="sr-only">
          {t(`${copy}.periodLabel`)}
        </label>
        <select
          id="sales-period"
          value={period}
          onChange={(event) => setPeriod(event.target.value as Period)}
          className="min-h-11 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
        >
          {PERIODS.map((option) => (
            <option key={option} value={option}>
              {t(`${copy}.period.${option}`)}
            </option>
          ))}
        </select>
        <label htmlFor="sales-search" className="sr-only">
          {t(`${copy}.searchLabel`)}
        </label>
        {/* min-w-[12rem]: com flex-1 e min-w-0 a busca encolhia para 35 px a
            390 px, espremida entre os dois selects (QA visual, 08/09). Com um
            minimo ela pula para a linha de baixo e ocupa a largura toda. */}
        <input
          id="sales-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t(`${copy}.searchPlaceholder`)}
          className="min-h-11 min-w-[12rem] flex-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        />
        <label htmlFor="sales-status" className="sr-only">
          {t(`${copy}.statusLabel`)}
        </label>
        <select
          id="sales-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className="min-h-11 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option} value={option}>
              {t(`${copy}.status.${option}`)}
            </option>
          ))}
        </select>
        <ExportTableButton rows={exportRows} filename="skillset-sales" />
      </div>

      <p className="text-sm text-[var(--color-ink-soft)]">{countLine}</p>

      {visibleOrders.length === 0 ? (
        <Card as="div" padding="none" className="p-8 text-center">
          <h2 className="display-title text-2xl text-[var(--color-primary)]">
            {t(`${copy}.emptyTitle`)}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
            {t(`${copy}.emptyBody`)}
          </p>
          <Link href="/teach/builder" className={buttonClasses({}, "mt-6")}>
            {t(`${copy}.emptyCta`)}
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {visibleOrders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] transition-colors hover:border-[var(--color-primary-light)]"
            >
              <div className="min-w-0">
                <Link
                  href={`/teach/sales/${order.id}`}
                  className="truncate text-sm font-semibold text-[var(--color-primary)] hover:underline"
                >
                  {order.courseTitle}
                </Link>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {formatDate(
                    toDate(order.createdAt),
                    locale,
                    t(`${copy}.datePending`),
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <StatusChip status={order.status} />
                <span className="text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency, locale)}
                </span>
                <a
                  href={stripeRefundUrl(order)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-[var(--color-primary)] underline underline-offset-4"
                >
                  {t(`${copy}.refundInStripe`)}
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hiddenCount > 0 ? (
        <Button
          variant="outline"
          onClick={() => setVisibleCount((count) => count + PAGE)}
          className="justify-self-start"
        >
          {t(`${copy}.showMore`).replace("{count}", () =>
            String(Math.min(hiddenCount, PAGE)),
          )}
        </Button>
      ) : null}

      <p className="text-xs leading-6 text-[var(--color-ink-soft)]">
        {t(`${copy}.stripeNote`)}{" "}
        <Link
          href="/account/payments"
          className="font-semibold text-[var(--color-primary)] hover:underline"
        >
          {t(`${copy}.learnMore`)}
        </Link>
      </p>
    </section>
  );
}
