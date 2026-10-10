/**
 * Overview de /ops: "como estamos?" em Hoje / 7 dias / 30 dias, cada numero
 * contra o periodo anterior de mesmo tamanho. Puro: nao le rede, nao formata,
 * nao conhece React. As linhas chegam cruas do Supabase (lidas pelo admin
 * sob as policies que ele ja tem) e saem como contagens e somas por moeda.
 *
 * Dias em UTC: a janela sai de epoch ms, entao o fuso do navegador de quem
 * olha nao muda o numero.
 */
import { isInternalSmokeCourse } from "@/domain/teacher-course";
import { DEFAULT_PLATFORM_FEE_BPS, isRefundableEnrollmentSource, platformFeeForSale } from "@/lib/payments/rules";
import { defaultSkillsetCurrency, fromStripeAmount } from "@/lib/payments/currencies";

export const overviewPeriods = ["today", "7d", "30d"] as const;
export type OverviewPeriod = (typeof overviewPeriods)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<OverviewPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

export function parseOverviewPeriod(value: string | null | undefined): OverviewPeriod {
  return overviewPeriods.find((period) => period === value) ?? "7d";
}

/** Instantes em epoch ms; as duas pontas de cada periodo sao inclusivas. */
export type OverviewWindow = {
  period: OverviewPeriod;
  days: number;
  start: number;
  end: number;
  previousStart: number;
  previousEnd: number;
};

// "7 dias" = hoje (ate agora) + os 6 dias UTC anteriores. O anterior e a mesma
// janela deslocada N dias: Today compara com ontem ate a mesma hora, nao com
// o dia inteiro de ontem (que sempre ganharia de um dia pela metade).
export function resolveOverviewWindow(period: OverviewPeriod, now = new Date()): OverviewWindow {
  const days = PERIOD_DAYS[period];
  const end = now.getTime();
  const start = Math.floor(end / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;
  const shift = days * DAY_MS;
  return { period, days, start, end, previousStart: start - shift, previousEnd: end - shift };
}

export type Measure = {
  current: number;
  previous: number;
  /** Um valor por dia UTC do periodo atual; vazio em Today. */
  series: number[];
};

function millis(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

type Slot = { current: true; day: number } | { current: false };

function slotOf(value: unknown, window: OverviewWindow): Slot | null {
  const time = millis(value);
  if (time === null) return null;
  if (time >= window.start && time <= window.end) {
    return { current: true, day: Math.floor((time - window.start) / DAY_MS) };
  }
  if (time >= window.previousStart && time <= window.previousEnd) return { current: false };
  return null;
}

export function measure<T>(
  rows: readonly T[],
  at: (row: T) => unknown,
  window: OverviewWindow,
  weight: (row: T) => number = () => 1,
): Measure {
  const result: Measure = {
    current: 0,
    previous: 0,
    series: window.days > 1 ? Array.from({ length: window.days }, () => 0) : [],
  };
  for (const row of rows) {
    const slot = slotOf(at(row), window);
    if (!slot) continue;
    const value = weight(row);
    if (!slot.current) {
      result.previous += value;
      continue;
    }
    result.current += value;
    if (result.series.length) result.series[slot.day] += value;
  }
  return result;
}

/** Valores na unidade interna (x100 em toda moeda); nunca somados entre moedas. */
export type MoneyLine = { currency: string; current: number; previous: number };

// USD (the platform default) first, the rest alphabetical.
function byCurrency(left: MoneyLine, right: MoneyLine): number {
  return Number(right.currency === defaultSkillsetCurrency) - Number(left.currency === defaultSkillsetCurrency)
    || left.currency.localeCompare(right.currency);
}

function measureMoney<T>(
  rows: readonly T[],
  at: (row: T) => unknown,
  currencyOf: (row: T) => string,
  amountOf: (row: T) => number,
  window: OverviewWindow,
): MoneyLine[] {
  const lines = new Map<string, MoneyLine>();
  for (const row of rows) {
    const slot = slotOf(at(row), window);
    if (!slot) continue;
    const currency = currencyOf(row).toUpperCase();
    const line = lines.get(currency) ?? { currency, current: 0, previous: 0 };
    line[slot.current ? "current" : "previous"] += amountOf(row);
    lines.set(currency, line);
  }
  return [...lines.values()].sort(byCurrency);
}

export function addMoney(left: readonly MoneyLine[], right: readonly MoneyLine[]): MoneyLine[] {
  const lines = new Map<string, MoneyLine>();
  for (const line of [...left, ...right]) {
    const merged = lines.get(line.currency) ?? { currency: line.currency, current: 0, previous: 0 };
    merged.current += line.current;
    merged.previous += line.previous;
    lines.set(line.currency, merged);
  }
  return [...lines.values()].sort(byCurrency);
}

// Mesmo predicado da loja e do sitemap: `smoke-` no id, "[QA]" no titulo.
function isRealCourse(id: string | null | undefined, title: string | null | undefined): boolean {
  return !isInternalSmokeCourse({ id: id ?? "", title: title ?? "" });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// --- Linhas cruas, so as colunas que o Overview le --------------------------

export type OverviewUserRow = { created_at: string; roles: unknown };
export type OverviewCourseRow = {
  id: string;
  title: string;
  owner_id: string;
  status: string;
  created_at: string | null;
};
export type OverviewAuditRow = { target_id: string; created_at: string | null; metadata: unknown };
export type OverviewEnrollmentRow = {
  course_id: string;
  course_title: string;
  source: string;
  created_at: string;
};
export type OverviewOrderRow = {
  course_id: string | null;
  course_title: string | null;
  status: string;
  amount_minor: number;
  currency: string;
  platform_fee_bps: number | null;
  /** Absent on rows read before the column existed: treat as 0. */
  platform_fee_fixed_minor?: number | null;
  refunded_amount_minor: number;
  paid_at: string | null;
  updated_at: string;
};

// --- Resumos, um por leitura ------------------------------------------------

/** Criador novo = cadastro do periodo que ja tem o papel de professor. */
export function summarizeUsers(rows: readonly OverviewUserRow[], window: OverviewWindow) {
  const creators = rows.filter((row) => Array.isArray(row.roles) && row.roles.includes("teacher"));
  return {
    signups: measure(rows, (row) => row.created_at, window),
    creators: measure(creators, (row) => row.created_at, window),
  };
}

export function summarizeCourses(rows: readonly OverviewCourseRow[], window: OverviewWindow) {
  const real = rows.filter((row) => isRealCourse(row.id, row.title));
  // Estado de agora, nao do periodo: nao ha data de publicacao no curso.
  const liveCreators = new Set(real.filter((row) => row.status === "published").map((row) => row.owner_id)).size;
  return { created: measure(real, (row) => row.created_at, window), liveCreators };
}

/**
 * Eventos COURSE_PUBLISHED_BY_CREATOR do audit_log: o curso nao guarda quando
 * foi publicado. Despublicar e publicar de novo no mesmo periodo conta uma vez.
 */
export function summarizePublications(rows: readonly OverviewAuditRow[], window: OverviewWindow): Measure {
  const real = rows
    .filter((row) => isRealCourse(row.target_id, String(record(row.metadata).title ?? "")))
    .map((row) => ({ row, slot: slotOf(row.created_at, window) }))
    .sort((left, right) => (millis(left.row.created_at) ?? 0) - (millis(right.row.created_at) ?? 0));
  const seen = new Set<string>();
  const firstPerPeriod = real.filter(({ row, slot }) => {
    if (!slot) return false;
    const key = `${slot.current}:${row.target_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return measure(firstPerPeriod.map(({ row }) => row), (row) => row.created_at, window);
}

/** Pagas = fontes que geram cobranca (payment, subscription); gratis = free_course. Concessoes so no total. */
export function summarizeEnrollments(rows: readonly OverviewEnrollmentRow[], window: OverviewWindow) {
  const real = rows.filter((row) => isRealCourse(row.course_id, row.course_title));
  const at = (row: OverviewEnrollmentRow) => row.created_at;
  return {
    total: measure(real, at, window),
    paid: measure(real.filter((row) => isRefundableEnrollmentSource(row.source)), at, window),
    free: measure(real.filter((row) => row.source === "free_course"), at, window),
  };
}

const REFUND_STATUSES = new Set(["refunded", "partially_refunded"]);

/**
 * Pedido = venda (renovacao de assinatura tambem vira pedido). Venda conta
 * por paid_at e so quando cobrou algo (cupom de 100% fica fora); reembolso
 * por updated_at, o momento em que o webhook gravou o desfecho (o pedido nao
 * tem refunded_at). Pagamento com falha fica fora: checkout expirado reescreve
 * "failed" para "cancelled", entao a contagem seria quase sempre 0.
 */
export function summarizeOrders(rows: readonly OverviewOrderRow[], window: OverviewWindow) {
  const real = rows.filter((row) => isRealCourse(row.course_id, row.course_title));
  const paid = real.filter((row) => row.paid_at && row.amount_minor > 0);
  const refunded = real.filter((row) => REFUND_STATUSES.has(row.status));
  const paidAt = (row: OverviewOrderRow) => row.paid_at;
  const updatedAt = (row: OverviewOrderRow) => row.updated_at;
  const currency = (row: OverviewOrderRow) => row.currency;
  return {
    paidOrders: measure(paid, paidAt, window),
    gross: measureMoney(paid, paidAt, currency, (row) => row.amount_minor, window),
    // A conta do webhook (percentual + parte fixa, platformFeeForSale) na
    // proporcao do que nao foi reembolsado: o reembolso devolve a taxa na mesma
    // proporcao (refund_application_fee: true), como a carteira do criador ja
    // desconta.
    platformFees: measureMoney(paid, paidAt, currency, (row) => {
      if (row.amount_minor <= 0) return 0;
      const fee = platformFeeForSale(
        row.amount_minor,
        row.platform_fee_bps ?? DEFAULT_PLATFORM_FEE_BPS,
        row.platform_fee_fixed_minor ?? 0,
      );
      return Math.floor((fee * Math.max(0, row.amount_minor - row.refunded_amount_minor)) / row.amount_minor);
    }, window),
    refunds: measure(refunded, updatedAt, window),
    refundedAmount: measureMoney(refunded, updatedAt, currency, (row) => row.refunded_amount_minor, window),
  };
}

/**
 * Eventos STOREFRONT_ACTIVATION_FEE_PAID: e o unico lugar legivel que guarda o
 * valor (a cobranca e da plataforma, sem linha em orders). Evento sem valor
 * gravado entra na contagem, nao na soma. Uma reentrega do webhook grava o
 * evento de novo: um pagamento (paymentIntentId) conta uma vez.
 */
export function summarizeActivations(allRows: readonly OverviewAuditRow[], window: OverviewWindow) {
  const seen = new Set<string>();
  const rows = allRows.filter((row) => {
    const paymentIntentId = record(row.metadata).paymentIntentId;
    if (typeof paymentIntentId !== "string" || !paymentIntentId) return true;
    if (seen.has(paymentIntentId)) return false;
    seen.add(paymentIntentId);
    return true;
  });
  const priced = rows.filter((row) => {
    const metadata = record(row.metadata);
    return typeof metadata.amountTotal === "number" && typeof metadata.currency === "string";
  });
  return {
    count: measure(rows, (row) => row.created_at, window),
    amount: measureMoney(
      priced,
      (row) => row.created_at,
      (row) => String(record(row.metadata).currency),
      (row) => {
        const metadata = record(row.metadata);
        return fromStripeAmount(Number(metadata.amountTotal), String(metadata.currency));
      },
      window,
    ),
  };
}
