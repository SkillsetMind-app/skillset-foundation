"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Card, EmptyState, InlineAlert, buttonClasses } from "@/components/ui";
import { SpotArt } from "@/components/ui/spot-art";
import { StripeDashboardButton } from "@/components/teacher/stripe-dashboard-button";
import { formatOrderRef, type Order } from "@/domain/order";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { toDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/format-money";

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

function formatDate(value: Date | null, locale: string, fallback: string) {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value);
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

const PAGE = 50;

export function SaleList() {
  const { user } = useAuth();
  const { locale, t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  // Uma releitura que falha com a tabela na tela nao apaga as vendas: o aviso
  // com "Try again" vai por cima delas. So sem nenhuma leitura boa a tela
  // inteira vira o erro.
  const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState<Period>("30d");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  // subscribeToTeacherOrders already pages through every order, so the client
  // holds the full set and sale 51+ was unreachable purely because the render
  // sliced at 50. Growing a window costs one number; a real paginated query
  // would cost a round trip we do not need.
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setError(false);
        setLoaded(true);
        setIsLoading(false);
      },
      () => {
        setError(true);
        setIsLoading(false);
      },
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [user]);

  // "Try again" le de novo pelo mesmo canal, sem desligar e religar.
  function retryLoad() {
    setError(false);
    if (!loaded) setIsLoading(true);
    void subscription.current?.reload();
  }

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
    // A tabela mostra o codigo como "#1A2B3C4D", mas o id guardado nao tem
    // "#": colar o codigo da tela nao achava nada. O codigo e o fim do id.
    const needle = search.trim().replace(/^#/, "").toLowerCase();
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

  if (error && !loaded) {
    // Era uma caixa vermelha muda: a lista sumia, aparecia vermelho, e nada
    // era anunciado.
    return (
      <div className="grid gap-3">
        <InlineAlert tone="error" className="p-6">
          {t(`${copy}.error`)}
        </InlineAlert>
        <button type="button" onClick={retryLoad} className="button-outline justify-self-start px-4 text-sm">
          {t("appErrors.retry")}
        </button>
      </div>
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
      {error ? (
        <div className="grid gap-3">
          <InlineAlert tone="error">{t(`${copy}.error`)}</InlineAlert>
          <button type="button" onClick={retryLoad} className="button-outline justify-self-start px-4 text-sm">
            {t("appErrors.retry")}
          </button>
        </div>
      ) : null}
      {/* O comprador paga na conta Stripe do professor: com pedido, a conta
          existe. Sem nenhum pedido o botao so podia dar o erro "conecte o
          Stripe" (o aviso de conectar ja esta logo acima). */}
      {orders.length > 0 ? (
        <>
          <StripeDashboardButton />
          <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("stripeDashboard.refundGuidance")}{" "}
            <Link href="/support" className="underline underline-offset-4">
              {t("stripeDashboard.refundSupport")}
            </Link>
          </p>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="sales-period" className="sr-only">
          {t(`${copy}.periodLabel`)}
        </label>
        <select
          id="sales-period"
          value={period}
          onChange={(event) => setPeriod(event.target.value as Period)}
          className="min-h-11 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
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
          className="min-h-11 min-w-[12rem] flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        />
        <label htmlFor="sales-status" className="sr-only">
          {t(`${copy}.statusLabel`)}
        </label>
        <select
          id="sales-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className="min-h-11 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
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

      {orders.length === 0 ? (
        // Nenhuma venda nunca: a cena do recibo, sem moeda e sem número. O
        // "nenhuma venda neste período" fica para quando já houve venda.
        <EmptyState
          as="h2"
          art={<SpotArt scene="noSales" />}
          title={t(`${copy}.firstTitle`)}
          action={
            <Link href="/teach/builder" className={buttonClasses({ variant: "outline" })}>
              {t(`${copy}.emptyCta`)}
            </Link>
          }
        />
      ) : visibleOrders.length === 0 ? (
        <Card as="div" padding="none" className="p-8 text-center">
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">
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
        // Uma tabela num cartao so: antes eram ate 50 cartoes soltos, sem
        // colunas, com o valor andando para os lados conforme a largura do
        // selo de status. Cartao estreito (celular, ou barra lateral aberta
        // num tablet): cada venda vira um bloco curto, com o valor a vista,
        // em vez de uma tabela que esconderia valor e link na rolagem lateral.
        <Card as="div" padding="none" className="@container overflow-hidden">
          <ul className="@2xl:hidden">
            {visibleOrders.map((order) => (
              <li
                key={order.id}
                className="flex items-start justify-between gap-3 border-b fine-rule px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/teach/sales/${order.id}`}
                    className="block truncate text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    {order.courseTitle}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-soft)]">
                    <StatusChip status={order.status} />
                    <span>{formatDate(toDate(order.createdAt), locale, t(`${copy}.datePending`))}</span>
                  </div>
                </div>
                <span className="num shrink-0 whitespace-nowrap text-right text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto @2xl:block">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">{t(`${copy}.tableCaption`)}</caption>
              <thead>
                <tr className="border-b fine-rule">
                  {(["colProduct", "colOrder", "colStatus", "colDate"] as const).map((head) => (
                    <th
                      key={head}
                      scope="col"
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
                    >
                      {t(`${copy}.${head}`)}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
                  >
                    {t(`${copy}.colAmount`)}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">{t(`${copy}.colActions`)}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const ref = formatOrderRef(order.id);
                  return (
                    <tr
                      key={order.id}
                      className="border-b fine-rule last:border-b-0 hover:bg-[var(--color-surface-soft)]"
                    >
                      <th scope="row" className="max-w-[16rem] px-4 py-3 font-semibold">
                        <Link
                          href={`/teach/sales/${order.id}`}
                          title={order.courseTitle}
                          className="block truncate text-[var(--color-primary)] hover:underline"
                        >
                          {order.courseTitle}
                        </Link>
                      </th>
                      <td className="num px-4 py-3 text-xs text-[var(--color-ink-soft)]">{ref}</td>
                      <td className="px-4 py-3">
                        <StatusChip status={order.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                        {formatDate(
                          toDate(order.createdAt),
                          locale,
                          t(`${copy}.datePending`),
                        )}
                      </td>
                      {/* O valor do pedido, na moeda DELE (nada soma moedas
                          aqui). Reembolso parcial: o valor cobrado e o selo
                          dizem o que aconteceu; o que sobrou fica na venda. */}
                      <td className="num whitespace-nowrap px-4 py-3 text-right font-bold text-[var(--color-primary)]">
                        {formatMoney(order.amountMinor, order.currency, locale)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/teach/sales/${order.id}`}
                          className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-xs font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          {t(`${copy}.view`)}
                          <span className="sr-only">: {order.courseTitle}, {ref}</span>
                          <ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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
