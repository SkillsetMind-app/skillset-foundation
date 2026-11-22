import { describe, expect, it } from "vitest";

import {
  buildReportProductRows,
  buildRevenueSeries,
  groupPaidOrdersByCurrency,
  type ReportWindow,
} from "@/domain/creator-reports";
import type { Order } from "@/domain/order";

// O que a pessoa sofria: com R$100 e $20 vendidos, o grafico e o quadro da
// Home somavam os dois e escreviam "$120". Receita so existe POR MOEDA.

function order(fields: Partial<Order>): Order {
  return {
    id: "o1",
    userId: "buyer-1",
    teacherId: "teacher-1",
    courseId: "c1",
    courseSlug: "curso",
    courseTitle: "Curso",
    amountMinor: 2_000,
    currency: "USD",
    platformFeeBps: 0,
    status: "paid",
    provider: "stripe",
    checkoutSessionId: null,
    paymentIntentId: null,
    createdAt: new Date(2026, 10, 10, 12).toISOString(),
    ...fields,
  } as Order;
}

const now = new Date(2026, 10, 20, 12);
const window: ReportWindow = { bucket: "month", count: 2, startMillis: null };

describe("receita por moeda", () => {
  const mixed = [
    order({ id: "brl", currency: "BRL", amountMinor: 10_000 }),
    order({ id: "usd-1", currency: "usd", amountMinor: 2_000 }),
    order({ id: "usd-2", currency: "USD", amountMinor: 500 }),
  ];

  it("agrupa por moeda, sem converter nem somar moedas diferentes", () => {
    expect(groupPaidOrdersByCurrency(mixed)).toEqual([
      // Mais pedidos primeiro: e a moeda que o grafico desenha.
      { currency: "USD", orders: 2, earningOrders: 2, totalMinor: 2_500 },
      { currency: "BRL", orders: 1, earningOrders: 1, totalMinor: 10_000 },
    ]);
  });

  it("empate em pedidos: ordem alfabetica", () => {
    const tie = [order({ currency: "USD" }), order({ currency: "BRL" })];
    expect(groupPaidOrdersByCurrency(tie).map((group) => group.currency)).toEqual(["BRL", "USD"]);
  });

  it("sem moeda gravada vira UNSPECIFIED, em grupo proprio", () => {
    expect(groupPaidOrdersByCurrency([order({ currency: "" })])).toEqual([
      { currency: "UNSPECIFIED", orders: 1, earningOrders: 1, totalMinor: 2_000 },
    ]);
  });

  // Cinco pedidos de $0 e um de R$100: o grafico desenhava USD, dizia "sem
  // receita" e o R$100 so aparecia na nota.
  it("so pedidos com dinheiro escolhem a moeda do grafico", () => {
    const orders = [
      ...Array.from({ length: 5 }, (_, index) => order({ id: `free-${index}`, currency: "USD", amountMinor: 0 })),
      order({ id: "brl", currency: "BRL", amountMinor: 10_000 }),
    ];
    expect(groupPaidOrdersByCurrency(orders)).toEqual([
      { currency: "BRL", orders: 1, earningOrders: 1, totalMinor: 10_000 },
      { currency: "USD", orders: 5, earningOrders: 0, totalMinor: 0 },
    ]);
  });

  // O webhook muda o status para "partially_refunded" e grava o acumulado
  // devolvido: $100 com $30 devolvidos sumiam da receita em vez de contar $70.
  it("reembolso parcial conta o que ficou, na moeda do pedido", () => {
    const partial = order({ status: "partially_refunded", amountMinor: 10_000, refundedAmountMinor: 3_000 });
    const full = order({ id: "full", status: "refunded", amountMinor: 5_000, refundedAmountMinor: 5_000 });

    expect(groupPaidOrdersByCurrency([partial, full])).toEqual([
      { currency: "USD", orders: 1, earningOrders: 1, totalMinor: 7_000 },
    ]);
    const series = buildRevenueSeries([partial, full], window, () => "m", "USD", now);
    expect(series.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(7_000);
    expect(buildReportProductRows([partial, full])).toMatchObject([
      { currency: "USD", orders: 1, grossMinor: 7_000, refunds: 2 },
    ]);
  });

  it("sem pedido: nenhum grupo", () => {
    expect(groupPaidOrdersByCurrency([])).toEqual([]);
  });

  it("a serie de uma moeda deixa as outras de fora (nada de R$100 + $20 num balde)", () => {
    const label = () => "m";
    const usd = buildRevenueSeries(mixed, window, label, "USD", now);
    const brl = buildRevenueSeries(mixed, window, label, "BRL", now);

    expect(usd.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(2_500);
    expect(brl.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(10_000);
  });

  it("a tabela por produto separa um produto vendido em duas moedas", () => {
    const rows = buildReportProductRows([
      ...mixed,
      order({ id: "brl-refund", currency: "BRL", status: "refunded", amountMinor: 10_000 }),
    ]);

    expect(rows.map(({ currency, orders, grossMinor, refunds }) => ({ currency, orders, grossMinor, refunds }))).toEqual([
      // O reembolso fica na linha da propria moeda e nao entra na receita.
      { currency: "BRL", orders: 1, grossMinor: 10_000, refunds: 1 },
      { currency: "USD", orders: 2, grossMinor: 2_500, refunds: 0 },
    ]);
  });
});
