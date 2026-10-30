// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  resolveLegacyPaymentOrigin,
  type LegacyEvidenceRead,
  type LegacyLedgerEvidence,
  type LegacyOrderEvidence,
  type LegacyPaymentOriginInput,
  type LegacySubscriptionEvidence,
} from "./legacy-payment-origin";

const target = {
  subscriptionId: "sub_A",
  userId: "buyer_A",
  courseId: "course_A",
  teacherId: "teacher_A",
};
const ok = <T>(data: T): LegacyEvidenceRead<T> => ({ status: "ok", data });
const ledger = (patch: Partial<LegacyLedgerEvidence> = {}): LegacyLedgerEvidence => ({
  id: "in_A",
  subscription_id: "sub_A",
  kind: "course_subscription",
  order_id: "in_A",
  invoice_id: "in_A",
  teacher_id: "teacher_A",
  course_id: "course_A",
  teacher_stripe_connected_account_id: "acct_A",
  status: "settled",
  ...patch,
});
const order = (patch: Partial<LegacyOrderEvidence> = {}): LegacyOrderEvidence => ({
  id: "in_A",
  user_id: "buyer_A",
  course_id: "course_A",
  teacher_id: "teacher_A",
  teacher_stripe_connected_account_id: "acct_A",
  payout_model: "direct_charge",
  provider: "stripe",
  status: "paid",
  ...patch,
});
const input = (patch: Partial<LegacyPaymentOriginInput> = {}): LegacyPaymentOriginInput => ({
  target,
  subscription: ok({
    id: "sub_A",
    stripe_subscription_id: "sub_A",
    user_id: "buyer_A",
    course_id: "course_A",
    teacher_id: "teacher_A",
  }),
  ledger: ok([ledger()]),
  orders: ok([order()]),
  ...patch,
});

function mirror(patch: Partial<LegacySubscriptionEvidence> = {}): LegacySubscriptionEvidence {
  return {
    id: "sub_A", stripe_subscription_id: "sub_A", user_id: "buyer_A",
    course_id: "course_A", teacher_id: "teacher_A", ...patch,
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe("resolveLegacyPaymentOrigin", () => {
  it("cruza a assinatura exata com ledger, pedido e partes", () => {
    expect(resolveLegacyPaymentOrigin(input())).toEqual({
      status: "resolved",
      candidate: { ...target, teacherConnectedAccountId: "acct_A", payoutModel: "direct_charge" },
      verification: "local_evidence_only",
      evidence: { ledgerIds: ["in_A"], orderIds: ["in_A"], invoiceIds: ["in_A"] },
    });
  });

  it("nao combina assinatura A com pedido B do mesmo comprador e curso", () => {
    const b = ledger({
      id: "in_B", order_id: "in_B", invoice_id: "in_B",
      subscription_id: "sub_B", teacher_stripe_connected_account_id: "acct_B",
    });
    const result = resolveLegacyPaymentOrigin(input({
      ledger: ok([b, ledger()]),
      orders: ok([order({ id: "in_B", teacher_stripe_connected_account_id: "acct_B" }), order()]),
    }));
    expect(result).toMatchObject({
      status: "resolved", candidate: { subscriptionId: "sub_A", teacherConnectedAccountId: "acct_A" },
      evidence: { orderIds: ["in_A"] },
    });
  });

  it("preserva origem quando o unico pedido ja foi reembolsado", () => {
    expect(resolveLegacyPaymentOrigin(input({
      ledger: ok([ledger({ status: "refunded" })]),
      orders: ok([order({ status: "refunded" })]),
    }))).toMatchObject({ status: "resolved", candidate: { teacherConnectedAccountId: "acct_A" } });
  });

  it("distingue conflito de contas", () => {
    expect(resolveLegacyPaymentOrigin(input({
      orders: ok([order({ teacher_stripe_connected_account_id: "acct_B" })]),
    }))).toEqual({ status: "conflict", reasons: ["account_mismatch"] });
  });

  it("distingue conflito de modelos entre faturas da mesma assinatura", () => {
    expect(resolveLegacyPaymentOrigin(input({
      ledger: ok([ledger(), ledger({ id: "in_A2", order_id: "in_A2", invoice_id: "in_A2" })]),
      orders: ok([order(), order({ id: "in_A2", payout_model: "destination_charge" })]),
    }))).toEqual({ status: "conflict", reasons: ["model_mismatch"] });
  });

  it("nao converte erro de leitura em ausencia", () => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: { status: "error" } })))
      .toEqual({ status: "read_error", sources: ["ledger"] });
  });

  it("primeira fatura zero sem ledger nao resolve pelo pedido isolado", () => {
    const zeroInvoice = { ...order(), amount_minor: 0 };
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([]), orders: ok([zeroInvoice]) })))
      .toEqual({ status: "missing", reasons: ["no_exact_ledger"] });
  });

  it("identidade errada e conflito, nao ausencia", () => {
    expect(resolveLegacyPaymentOrigin(input({ orders: ok([order({ user_id: "buyer_B" })]) })))
      .toEqual({ status: "conflict", reasons: ["identity_mismatch"] });
  });

  it("conta nula nao significa plataforma", () => {
    expect(resolveLegacyPaymentOrigin(input({
      orders: ok([order({ teacher_stripe_connected_account_id: null })]),
    }))).toEqual({ status: "missing", reasons: ["incomplete_evidence"] });
  });

  it.each(["paid", "refunded", "partially_refunded", "pending", "failed", "cancelled"])(
    "status %s nao seleciona nem apaga identidade",
    (status) => {
      expect(resolveLegacyPaymentOrigin(input({
        ledger: ok([ledger({ status })]), orders: ok([order({ status })]),
      }))).toMatchObject({ status: "resolved", candidate: { teacherConnectedAccountId: "acct_A" } });
    },
  );

  it.each(["direct_charge", "destination_charge", "separate_charges_and_transfers"])(
    "%s preserva modelo e conta do professor sem declarar conta da cobranca",
    (payout_model) => {
      const result = resolveLegacyPaymentOrigin(input({ orders: ok([order({ payout_model })]) }));
      expect(result).toEqual({
        status: "resolved", verification: "local_evidence_only",
        candidate: { ...target, teacherConnectedAccountId: "acct_A", payoutModel: payout_model },
        evidence: { ledgerIds: ["in_A"], orderIds: ["in_A"], invoiceIds: ["in_A"] },
      });
    },
  );

  it.each(["subscription", "ledger", "orders"] as const)("falha de %s e erro de leitura", (source) => {
    expect(resolveLegacyPaymentOrigin(input({ [source]: { status: "error" } })))
      .toEqual({ status: "read_error", sources: [source] });
  });

  it("mantem todas as fontes com erro, sem tentar fallback", () => {
    expect(resolveLegacyPaymentOrigin(input({
      subscription: { status: "error" }, ledger: { status: "error" }, orders: { status: "error" },
    }))).toEqual({ status: "read_error", sources: ["subscription", "ledger", "orders"] });
  });

  it("espelho ausente nao e erro de leitura", () => {
    expect(resolveLegacyPaymentOrigin(input({ subscription: ok(null) })))
      .toEqual({ status: "missing", reasons: ["subscription_missing"] });
  });

  it.each(["subscriptionId", "userId", "courseId", "teacherId"] as const)(
    "nao aceita identidade solicitada vazia: %s", (field) => {
      expect(resolveLegacyPaymentOrigin(input({ target: { ...target, [field]: "" } })))
        .toEqual({ status: "missing", reasons: ["incomplete_identity"] });
    },
  );

  it("nao normaliza silenciosamente a assinatura solicitada", () => {
    expect(resolveLegacyPaymentOrigin(input({ target: { ...target, subscriptionId: " sub_A " } })))
      .toEqual({ status: "missing", reasons: ["incomplete_identity"] });
  });

  it.each(["id", "stripe_subscription_id", "user_id", "course_id", "teacher_id"] as const)(
    "confronta identidade do espelho: %s", (field) => {
      expect(resolveLegacyPaymentOrigin(input({ subscription: ok(mirror({ [field]: "wrong" })) })))
        .toEqual({ status: "conflict", reasons: ["identity_mismatch"] });
    },
  );

  it.each(["stripe_subscription_id", "course_id", "teacher_id"] as const)(
    "nao completa identidade nula do espelho: %s", (field) => {
      expect(resolveLegacyPaymentOrigin(input({ subscription: ok(mirror({ [field]: null })) })))
        .toEqual({ status: "missing", reasons: ["incomplete_evidence"] });
    },
  );

  it.each(["course_id", "teacher_id"] as const)("confere partes do ledger: %s", (field) => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger({ [field]: "wrong" })]) })))
      .toEqual({ status: "conflict", reasons: ["identity_mismatch"] });
  });

  it.each(["user_id", "course_id", "teacher_id"] as const)("confere partes do pedido: %s", (field) => {
    expect(resolveLegacyPaymentOrigin(input({ orders: ok([order({ [field]: "wrong" })]) })))
      .toEqual({ status: "conflict", reasons: ["identity_mismatch"] });
  });

  it.each(["course_id", "kind", "order_id", "invoice_id", "teacher_stripe_connected_account_id"] as const)(
    "ledger incompleto nao resolve: %s", (field) => {
      expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger({ [field]: null })]) })))
        .toEqual({ status: "missing", reasons: ["incomplete_evidence"] });
    },
  );

  it.each(["course_id", "teacher_id", "teacher_stripe_connected_account_id", "payout_model", "provider"] as const)(
    "pedido incompleto nao resolve: %s", (field) => {
      expect(resolveLegacyPaymentOrigin(input({ orders: ok([order({ [field]: null })]) })))
        .toEqual({ status: "missing", reasons: ["incomplete_evidence"] });
    },
  );

  it("modelo desconhecido nao recebe default direct ou plataforma", () => {
    expect(resolveLegacyPaymentOrigin(input({ orders: ok([order({ payout_model: "future_model" })]) })))
      .toEqual({ status: "missing", reasons: ["unknown_model"] });
  });

  it("provider divergente e conflito", () => {
    expect(resolveLegacyPaymentOrigin(input({ orders: ok([order({ provider: "other_provider" })]) })))
      .toEqual({ status: "conflict", reasons: ["provider_mismatch"] });
  });

  it("ledger de outro tipo para a assinatura exata e conflito", () => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger({ kind: "course_purchase" })]) })))
      .toEqual({ status: "conflict", reasons: ["ledger_kind_mismatch"] });
  });

  it("invoice_id divergente do pedido e conflito", () => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger({ invoice_id: "in_other" })]) })))
      .toEqual({ status: "conflict", reasons: ["invoice_order_mismatch"] });
  });

  it("pedido referenciado ausente nao e substituido por outro do mesmo comprador e curso", () => {
    expect(resolveLegacyPaymentOrigin(input({ orders: ok([order({ id: "in_B" })]) })))
      .toEqual({ status: "missing", reasons: ["order_missing"] });
  });

  it.each([null, "sub_B", "sub_A_suffix"])("ledger da assinatura %s nao prova A", (subscription_id) => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger({ subscription_id })]) })))
      .toEqual({ status: "missing", reasons: ["no_exact_ledger"] });
  });

  it("mesma fatura ligada a duas assinaturas e conflito", () => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger(), ledger({ subscription_id: "sub_B" })]) })))
      .toEqual({ status: "conflict", reasons: ["subscription_link_mismatch"] });
  });

  it("vinculo duplicado sem assinatura nao e descartado diante de candidato valido", () => {
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([ledger(), ledger({ subscription_id: null })]) })))
      .toEqual({ status: "missing", reasons: ["incomplete_evidence"] });
  });

  it("mesmo id de ledger nao pode apontar a faturas diferentes", () => {
    expect(resolveLegacyPaymentOrigin(input({
      ledger: ok([ledger(), ledger({ order_id: "in_A2", invoice_id: "in_A2" })]),
      orders: ok([order(), order({ id: "in_A2" })]),
    }))).toEqual({ status: "conflict", reasons: ["invoice_order_mismatch"] });
  });

  it("duas faturas da mesma assinatura com contas diferentes conflitam", () => {
    expect(resolveLegacyPaymentOrigin(input({
      ledger: ok([ledger(), ledger({
        id: "in_A2", order_id: "in_A2", invoice_id: "in_A2", teacher_stripe_connected_account_id: "acct_B",
      })]),
      orders: ok([order(), order({ id: "in_A2", teacher_stripe_connected_account_id: "acct_B" })]),
    }))).toEqual({ status: "conflict", reasons: ["account_mismatch"] });
  });

  it("pedido duplicado divergente nao e sobrescrito por Map", () => {
    expect(resolveLegacyPaymentOrigin(input({
      orders: ok([order(), order({ teacher_stripe_connected_account_id: "acct_B", payout_model: "destination_charge" })]),
    }))).toEqual({ status: "conflict", reasons: ["account_mismatch", "model_mismatch"] });
  });

  it("evidencia incompleta nao mascara conflito conhecido", () => {
    expect(resolveLegacyPaymentOrigin(input({
      orders: ok([order({ teacher_id: null, teacher_stripe_connected_account_id: "acct_B" })]),
    }))).toEqual({ status: "conflict", reasons: ["account_mismatch"] });
  });

  it("uma fatura coerente nao oculta outra incompleta", () => {
    expect(resolveLegacyPaymentOrigin(input({
      ledger: ok([ledger(), ledger({ id: "in_A2", order_id: "in_A2", invoice_id: "in_A2" })]),
      orders: ok([order(), order({ id: "in_A2", payout_model: null })]),
    }))).toEqual({ status: "missing", reasons: ["incomplete_evidence"] });
  });

  it("perfil atual, ultimo pedido, pais e IP nao sao fontes de origem", () => {
    const extraContext = {
      ...input(), currentProfileAccount: "acct_B", latestOrder: order({ id: "in_B" }),
      country: "BR", ip: "192.0.2.1",
    };
    expect(resolveLegacyPaymentOrigin(extraContext)).toEqual(resolveLegacyPaymentOrigin(input()));
    expect(resolveLegacyPaymentOrigin({ ...extraContext, ledger: ok([]) }))
      .toEqual({ status: "missing", reasons: ["no_exact_ledger"] });
  });

  it("e deterministico, deduplica evidencia identica e nao altera entradas congeladas", () => {
    const rows = [ledger({ id: "in_A2", order_id: "in_A2", invoice_id: "in_A2" }), ledger(), ledger()];
    const orders = [order({ id: "in_A2" }), order(), order()];
    const frozen = freezeDeep(input({ ledger: ok(rows), orders: ok(orders) }));
    const before = JSON.stringify(frozen);
    const resolved = resolveLegacyPaymentOrigin(frozen);
    expect(resolved).toMatchObject({
      status: "resolved", evidence: {
        ledgerIds: ["in_A", "in_A2"], orderIds: ["in_A", "in_A2"], invoiceIds: ["in_A", "in_A2"],
      },
    });
    expect(resolveLegacyPaymentOrigin(input({ ledger: ok([...rows].reverse()), orders: ok([...orders].reverse()) })))
      .toEqual(resolved);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});
