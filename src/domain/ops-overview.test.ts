import { describe, expect, it } from "vitest";

import {
  addMoney,
  measure,
  parseOverviewPeriod,
  resolveOverviewWindow,
  summarizeActivations,
  summarizeCourses,
  summarizeEnrollments,
  summarizeOrders,
  summarizePublications,
  summarizeUsers,
  type OverviewOrderRow,
} from "./ops-overview";

// Fixtures only: no real numbers, ids or people.
const NOW = new Date("2026-10-05T15:30:00.000Z");

describe("periodo do Overview", () => {
  it("aceita so os tres periodos e cai em 7 dias para o resto", () => {
    expect(parseOverviewPeriod("today")).toBe("today");
    expect(parseOverviewPeriod("30d")).toBe("30d");
    for (const value of [null, undefined, "", "90d", "TODAY"]) {
      expect(parseOverviewPeriod(value)).toBe("7d");
    }
  });

  it("Today vai da meia-noite UTC ate agora e compara com as mesmas horas de ontem", () => {
    const window = resolveOverviewWindow("today", NOW);
    expect(window.days).toBe(1);
    expect(new Date(window.start).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(new Date(window.end).toISOString()).toBe("2026-10-05T15:30:00.000Z");
    expect(new Date(window.previousStart).toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(new Date(window.previousEnd).toISOString()).toBe("2026-10-04T15:30:00.000Z");
  });

  it("7 e 30 dias incluem hoje e o periodo anterior tem o mesmo tamanho, deslocado N dias", () => {
    const week = resolveOverviewWindow("7d", NOW);
    expect(new Date(week.start).toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(new Date(week.previousStart).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(new Date(week.previousEnd).toISOString()).toBe("2026-09-28T15:30:00.000Z");
    expect(week.end - week.start).toBe(week.previousEnd - week.previousStart);

    const month = resolveOverviewWindow("30d", NOW);
    expect(new Date(month.start).toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(new Date(month.previousStart).toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(month.end - month.start).toBe(month.previousEnd - month.previousStart);
  });

  it("corta o dia em UTC, nao no fuso do navegador", () => {
    // 02:00 UTC ainda e "ontem" em UTC-3; o recorte nao muda por isso.
    const window = resolveOverviewWindow("today", new Date("2026-10-05T02:00:00.000Z"));
    expect(new Date(window.start).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    const rows = [
      "2026-10-05T00:00:00.000Z", // primeiro instante de hoje
      "2026-10-04T23:59:59.999Z", // ontem, depois das 02:00: fora da comparacao
      "2026-10-04T01:00:00.000Z", // ontem, antes das 02:00
    ];
    expect(measure(rows, (row) => row, window)).toMatchObject({ current: 1, previous: 1 });
  });
});

describe("measure", () => {
  it("separa atual e anterior, ignora fora da janela e data invalida", () => {
    const window = resolveOverviewWindow("today", NOW);
    const rows = [
      "2026-10-05T01:00:00Z", // hoje
      "2026-10-05T15:30:00Z", // agora exato conta
      "2026-10-04T10:00:00Z", // ontem, antes da mesma hora
      "2026-10-04T20:00:00Z", // ontem, depois da mesma hora: fora da comparacao
      "2026-10-03T10:00:00Z", // anteontem
      "not-a-date",
      null,
    ];
    expect(measure(rows, (row) => row, window)).toEqual({ current: 2, previous: 1, series: [] });
  });

  it("monta a serie diaria so para 7 e 30 dias, com peso opcional", () => {
    const window = resolveOverviewWindow("7d", NOW);
    const rows = [
      { at: "2026-09-29T00:00:00Z", n: 2 },
      { at: "2026-09-29T23:59:59Z", n: 1 },
      { at: "2026-10-05T09:00:00Z", n: 5 },
      { at: "2026-09-25T09:00:00Z", n: 7 },
    ];
    expect(measure(rows, (row) => row.at, window, (row) => row.n)).toEqual({
      current: 8,
      previous: 7,
      series: [3, 0, 0, 0, 0, 0, 5],
    });
  });
});

describe("cadastros", () => {
  it("conta cadastros e, entre eles, quem entrou como criador", () => {
    const window = resolveOverviewWindow("7d", NOW);
    const summary = summarizeUsers([
      { created_at: "2026-10-01T10:00:00Z", roles: ["student"] },
      { created_at: "2026-10-02T10:00:00Z", roles: ["student", "teacher"] },
      { created_at: "2026-09-23T10:00:00Z", roles: ["teacher"] },
      { created_at: "2026-10-03T10:00:00Z", roles: null },
    ], window);
    expect(summary.signups).toMatchObject({ current: 3, previous: 1 });
    expect(summary.creators).toMatchObject({ current: 1, previous: 1 });
  });
});

describe("cursos reais", () => {
  const window = resolveOverviewWindow("7d", NOW);

  it("ignora cursos internos de teste (smoke- e [QA]) em criados e em criadores no ar", () => {
    const summary = summarizeCourses([
      { id: "course-a", title: "Real course", owner_id: "creator-1", status: "published", created_at: "2026-10-01T00:00:00Z" },
      { id: "course-b", title: "Another", owner_id: "creator-1", status: "published", created_at: "2026-01-01T00:00:00Z" },
      { id: "course-c", title: "Draft", owner_id: "creator-2", status: "draft", created_at: "2026-10-02T00:00:00Z" },
      { id: "smoke-checkout", title: "Smoke", owner_id: "creator-3", status: "published", created_at: "2026-10-02T00:00:00Z" },
      { id: "course-qa", title: "[QA] Access matrix", owner_id: "creator-4", status: "published", created_at: "2026-10-02T00:00:00Z" },
    ], window);
    expect(summary.created).toMatchObject({ current: 2, previous: 0 });
    expect(summary.liveCreators).toBe(1);
  });

  it("conta cada curso publicado uma vez por periodo e tira os de teste pelo titulo gravado", () => {
    const published = summarizePublications([
      { target_id: "course-a", created_at: "2026-10-01T00:00:00Z", metadata: { title: "Real" } },
      { target_id: "course-a", created_at: "2026-10-02T00:00:00Z", metadata: { title: "Real" } },
      { target_id: "course-a", created_at: "2026-09-24T00:00:00Z", metadata: { title: "Real" } },
      { target_id: "course-qa", created_at: "2026-10-02T00:00:00Z", metadata: { title: "[QA] Matrix" } },
      { target_id: "smoke-1", created_at: "2026-10-02T00:00:00Z", metadata: null },
    ], window);
    expect(published).toMatchObject({ current: 1, previous: 1 });
    expect(published.series.reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});

describe("matriculas", () => {
  it("separa pagas de gratuitas e tira curso de teste", () => {
    const window = resolveOverviewWindow("7d", NOW);
    const summary = summarizeEnrollments([
      { course_id: "course-a", course_title: "Real", source: "payment", created_at: "2026-10-01T00:00:00Z" },
      { course_id: "course-a", course_title: "Real", source: "subscription", created_at: "2026-10-01T00:00:00Z" },
      { course_id: "course-b", course_title: "Free", source: "free_course", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "course-b", course_title: "Free", source: "admin", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "smoke-x", course_title: "Smoke", source: "payment", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "course-b", course_title: "Free", source: "free_course", created_at: "2026-09-23T00:00:00Z" },
    ], window);
    expect(summary.total).toMatchObject({ current: 4, previous: 1 });
    expect(summary.paid).toMatchObject({ current: 2, previous: 0 });
    expect(summary.free).toMatchObject({ current: 1, previous: 1 });
  });
});

describe("dinheiro", () => {
  const window = resolveOverviewWindow("7d", NOW);
  const order = (overrides: Partial<OverviewOrderRow>): OverviewOrderRow => ({
    course_id: "course-a", course_title: "Real", status: "paid", amount_minor: 10_000,
    currency: "USD", platform_fee_bps: 1000, refunded_amount_minor: 0,
    paid_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...overrides,
  });

  it("soma vendas e taxa da plataforma por moeda, sem misturar moedas e sem pedidos de teste", () => {
    const summary = summarizeOrders([
      order({}),
      order({ amount_minor: 5_000, platform_fee_bps: 500 }),
      order({ currency: "EUR", amount_minor: 2_000, platform_fee_bps: null }),
      order({ paid_at: "2026-09-24T00:00:00Z", updated_at: "2026-09-24T00:00:00Z" }),
      order({ course_id: "smoke-checkout", amount_minor: 99_999 }),
      order({ course_title: "[QA] Matrix", amount_minor: 99_999 }),
      order({ status: "pending", paid_at: null }),
    ], window);
    expect(summary.paidOrders).toMatchObject({ current: 3, previous: 1 });
    // USD (a moeda padrao) primeiro, o resto em ordem alfabetica.
    expect(summary.gross).toEqual([
      { currency: "USD", current: 15_000, previous: 10_000 },
      { currency: "EUR", current: 2_000, previous: 0 },
    ]);
    // Mesmo calculo que o webhook grava no ledger: floor(bruto * bps / 10000),
    // e a taxa padrao quando o pedido nao congelou nenhuma.
    expect(summary.platformFees).toEqual([
      { currency: "USD", current: 1_250, previous: 1_000 },
      { currency: "EUR", current: 200, previous: 0 },
    ]);
  });

  it("um pedido pago e depois reembolsado continua na venda bruta e aparece no reembolso", () => {
    const summary = summarizeOrders([
      order({ status: "refunded", refunded_amount_minor: 10_000, updated_at: "2026-10-03T00:00:00Z" }),
      order({ status: "partially_refunded", refunded_amount_minor: 2_500, paid_at: "2026-08-01T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" }),
      order({ status: "failed", paid_at: null, updated_at: "2026-10-02T00:00:00Z" }),
      order({ status: "failed", paid_at: null, updated_at: "2026-09-23T00:00:00Z" }),
    ], window);
    expect(summary.paidOrders).toMatchObject({ current: 1, previous: 0 });
    expect(summary.gross).toEqual([{ currency: "USD", current: 10_000, previous: 0 }]);
    expect(summary.refunds).toMatchObject({ current: 2, previous: 0 });
    expect(summary.refundedAmount).toEqual([{ currency: "USD", current: 12_500, previous: 0 }]);
    expect(summary.failed).toMatchObject({ current: 1, previous: 1 });
  });

  it("receita da plataforma soma taxa e ativacao moeda a moeda", () => {
    expect(addMoney(
      [{ currency: "USD", current: 1_000, previous: 500 }],
      [{ currency: "EUR", current: 300, previous: 0 }, { currency: "USD", current: 2_500, previous: 0 }],
    )).toEqual([
      { currency: "USD", current: 3_500, previous: 500 },
      { currency: "EUR", current: 300, previous: 0 },
    ]);
  });

  it("taxa de ativacao: conta todas e soma so as que gravaram valor, na unidade interna", () => {
    const summary = summarizeActivations([
      { target_id: "u1", created_at: "2026-10-01T00:00:00Z", metadata: { amountTotal: 2_500, currency: "usd" } },
      { target_id: "u2", created_at: "2026-10-02T00:00:00Z", metadata: {} },
      { target_id: "u3", created_at: "2026-10-02T00:00:00Z", metadata: { amountTotal: 1_000, currency: "jpy" } },
      { target_id: "u4", created_at: "2026-09-23T00:00:00Z", metadata: { amountTotal: 2_500, currency: "usd" } },
    ], window);
    expect(summary.count).toMatchObject({ current: 3, previous: 1 });
    expect(summary.amount).toEqual([
      { currency: "USD", current: 2_500, previous: 2_500 },
      { currency: "JPY", current: 100_000, previous: 0 },
    ]);
  });
});
