/**
 * Recorte por periodo da pagina de relatorios do professor.
 * Puro: nao le rede, nao formata dinheiro, nao conhece React.
 *
 * A janela (`resolveReportWindow`) e a unica fonte da verdade: o grafico e os
 * KPIs saem do mesmo `startMillis`, entao a linha e o numero nunca contam
 * periodos diferentes.
 */
import { isPaidOrder, type Order, type OrderStatus } from "@/domain/order";
import { toDate } from "@/lib/format-date";

export type ReportPeriod = "7d" | "30d" | "90d" | "12m" | "all";

/** O seletor da home ja existia com estes quatro; nao mexemos neles. */
export type RevenueRange = "3m" | "6m" | "12m" | "all";

export type RevenueBucket = "day" | "month";

export type ReportWindow = {
  bucket: RevenueBucket;
  count: number;
  /** null = sem limite inferior ("All"). */
  startMillis: number | null;
};

export type RevenuePoint = {
  key: string;
  label: string;
  grossMinor: number;
};

export type ReportProductRow = {
  courseId: string;
  courseTitle: string;
  currency: string;
  orders: number;
  grossMinor: number;
  refunds: number;
};

export type RefundRate = {
  refundedCount: number;
  /** Pagos + reembolsados: tudo que um dia cobrou. */
  collectedCount: number;
  /** Em pontos percentuais, uma casa. 0 quando ninguem pagou nada ainda. */
  rate: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Um pedido reembolsado foi pago antes: ele entra no denominador da taxa,
// senao um mes com 1 venda e 1 reembolso mostraria 100% de reembolso sobre
// zero venda restante.
const REFUNDED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "refunded",
  "partially_refunded",
]);

export function isRefundedOrder(status: OrderStatus): boolean {
  return REFUNDED_STATUSES.has(status);
}

export function getTimestampMillis(value: unknown): number | null {
  return toDate(value)?.getTime() ?? null;
}

/**
 * "All" olha do pedido pago mais antigo ate agora, com o numero de baldes
 * preso em [1, 24] para o grafico mensal continuar legivel.
 */
export function getRevenueMonthsBack(
  paidOrders: Order[],
  range: RevenueRange,
  now: Date,
): number {
  if (range === "3m") return 3;
  if (range === "6m") return 6;
  if (range === "12m") return 12;

  const earliest = paidOrders
    .map((order) => getTimestampMillis(order.createdAt))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];

  if (!earliest) return 12;

  const earliestDate = new Date(earliest);
  const monthSpan =
    (now.getFullYear() - earliestDate.getFullYear()) * 12 +
    (now.getMonth() - earliestDate.getMonth()) +
    1;

  return Math.min(24, Math.max(1, monthSpan));
}

function startOfMonthsBack(now: Date, monthsBack: number): number {
  return new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1).getTime();
}

function startOfDaysBack(now: Date, daysBack: number): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return midnight.getTime() - (daysBack - 1) * DAY_MS;
}

/** Janela da home: sempre mensal, com os mesmos baldes de antes. */
export function resolveRevenueRangeWindow(
  paidOrders: Order[],
  range: RevenueRange,
  now = new Date(),
): ReportWindow {
  const count = getRevenueMonthsBack(paidOrders, range, now);

  return {
    bucket: "month",
    count,
    startMillis: range === "all" ? null : startOfMonthsBack(now, count),
  };
}

/** Janela dos relatorios: dia ate 90d, mes de 12M pra cima. */
export function resolveReportWindow(
  paidOrders: Order[],
  period: ReportPeriod,
  now = new Date(),
): ReportWindow {
  if (period === "7d" || period === "30d" || period === "90d") {
    const count = Number.parseInt(period, 10);
    return { bucket: "day", count, startMillis: startOfDaysBack(now, count) };
  }

  return resolveRevenueRangeWindow(paidOrders, period, now);
}

export function isWithinWindow(value: unknown, window: ReportWindow): boolean {
  if (window.startMillis === null) return true;
  const millis = getTimestampMillis(value);
  // Sem data confiavel o registro conta como de agora, igual ao grafico.
  return millis === null || millis >= window.startMillis;
}

function bucketKey(date: Date, bucket: RevenueBucket): string {
  return bucket === "month"
    ? `${date.getFullYear()}-${date.getMonth()}`
    : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function buildRevenueSeries(
  paidOrders: Order[],
  window: ReportWindow,
  formatLabel: (date: Date, bucket: RevenueBucket) => string,
  now = new Date(),
): RevenuePoint[] {
  const points = Array.from({ length: window.count }, (_, index) => {
    const date =
      window.bucket === "month"
        ? new Date(now.getFullYear(), now.getMonth() - (window.count - 1) + index, 1)
        : new Date(startOfDaysBack(now, window.count) + index * DAY_MS);

    return {
      key: bucketKey(date, window.bucket),
      label: formatLabel(date, window.bucket),
      grossMinor: 0,
    };
  });

  const byKey = new Map(points.map((point) => [point.key, point]));

  for (const order of paidOrders) {
    const millis = getTimestampMillis(order.createdAt);
    const date = millis === null ? now : new Date(millis);
    const point = byKey.get(bucketKey(date, window.bucket));
    if (point) point.grossMinor += order.amountMinor;
  }

  return points;
}

export function calculateRefundRate(orders: Order[]): RefundRate {
  const paidCount = orders.filter((order) => isPaidOrder(order.status)).length;
  const refundedCount = orders.filter((order) =>
    isRefundedOrder(order.status),
  ).length;
  const collectedCount = paidCount + refundedCount;

  return {
    refundedCount,
    collectedCount,
    rate: collectedCount
      ? Number(((refundedCount / collectedCount) * 100).toFixed(1))
      : 0,
  };
}

/**
 * Mesma contagem do "Top courses" da home, mas com todas as linhas, os
 * reembolsos do periodo e ordenada pela receita.
 */
export function buildReportProductRows(orders: Order[]): ReportProductRow[] {
  const byCourse = new Map<string, ReportProductRow>();

  for (const order of orders) {
    const isPaid = isPaidOrder(order.status);
    const isRefund = isRefundedOrder(order.status);
    if (!isPaid && !isRefund) continue;

    const row = byCourse.get(order.courseId) ?? {
      courseId: order.courseId,
      courseTitle: order.courseTitle,
      currency: String(order.currency || "USD").toUpperCase(),
      orders: 0,
      grossMinor: 0,
      refunds: 0,
    };

    if (isPaid) {
      row.orders += 1;
      row.grossMinor += order.amountMinor;
    } else {
      row.refunds += 1;
    }

    byCourse.set(order.courseId, row);
  }

  return [...byCourse.values()].sort(
    (left, right) =>
      right.grossMinor - left.grossMinor ||
      left.courseTitle.localeCompare(right.courseTitle),
  );
}
