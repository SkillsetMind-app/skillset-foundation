import type { Order } from "@/domain/order";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type LegacySubscriptionEvidence = Readonly<Pick<
  Tables["course_subscriptions"]["Row"],
  "id" | "stripe_subscription_id" | "user_id" | "course_id" | "teacher_id"
>>;
export type LegacyLedgerEvidence = Readonly<Pick<
  Tables["payout_ledger"]["Row"],
  "id" | "subscription_id" | "kind" | "order_id" | "invoice_id" |
  "teacher_id" | "course_id" | "teacher_stripe_connected_account_id" | "status"
>>;
export type LegacyOrderEvidence = Readonly<Pick<
  Tables["orders"]["Row"],
  "id" | "user_id" | "course_id" | "teacher_id" |
  "teacher_stripe_connected_account_id" | "payout_model" | "provider" | "status"
>>;

export type LegacyEvidenceRead<T> =
  | { readonly status: "ok"; readonly data: T }
  | { readonly status: "error" };

export type LegacySubscriptionIdentity = {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly courseId: string;
  readonly teacherId: string;
};

export type LegacyPaymentOriginInput = {
  readonly target: LegacySubscriptionIdentity;
  readonly subscription: LegacyEvidenceRead<LegacySubscriptionEvidence | null>;
  readonly ledger: LegacyEvidenceRead<readonly LegacyLedgerEvidence[]>;
  readonly orders: LegacyEvidenceRead<readonly LegacyOrderEvidence[]>;
};

type MissingReason =
  | "incomplete_identity"
  | "subscription_missing"
  | "no_exact_ledger"
  | "order_missing"
  | "incomplete_evidence"
  | "unknown_model";
type ConflictReason =
  | "identity_mismatch"
  | "ledger_kind_mismatch"
  | "invoice_order_mismatch"
  | "subscription_link_mismatch"
  | "account_mismatch"
  | "model_mismatch"
  | "provider_mismatch";
type EvidenceSource = "subscription" | "ledger" | "orders";

export type LegacyPaymentOriginResult =
  | {
      readonly status: "resolved";
      readonly candidate: LegacySubscriptionIdentity & {
        // Snapshot do professor/beneficiario, nao prova da conta da cobranca.
        readonly teacherConnectedAccountId: string;
        readonly payoutModel: NonNullable<Order["payoutModel"]>;
      };
      readonly verification: "local_evidence_only";
      readonly evidence: {
        readonly ledgerIds: readonly string[];
        readonly orderIds: readonly string[];
        readonly invoiceIds: readonly string[];
      };
    }
  | { readonly status: "missing"; readonly reasons: readonly MissingReason[] }
  | { readonly status: "conflict"; readonly reasons: readonly ConflictReason[] }
  | { readonly status: "read_error"; readonly sources: readonly EvidenceSource[] };

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isPayoutModel(value: string): value is NonNullable<Order["payoutModel"]> {
  return value === "direct_charge" || value === "destination_charge" ||
    value === "separate_charges_and_transfers";
}

// Resolve apenas evidencias locais; nao comprova modo Stripe nem autoriza mutacao.
export function resolveLegacyPaymentOrigin(
  input: LegacyPaymentOriginInput,
): LegacyPaymentOriginResult {
  const sources: EvidenceSource[] = [];
  if (input.subscription.status === "error") sources.push("subscription");
  if (input.ledger.status === "error") sources.push("ledger");
  if (input.orders.status === "error") sources.push("orders");
  if (
    input.subscription.status === "error" || input.ledger.status === "error" ||
    input.orders.status === "error"
  ) return { status: "read_error", sources };

  const { target } = input;
  if (![target.subscriptionId, target.userId, target.courseId, target.teacherId].every(isId)) {
    return { status: "missing", reasons: ["incomplete_identity"] };
  }

  const missing = new Set<MissingReason>();
  const conflicts = new Set<ConflictReason>();
  const accounts = new Set<string>();
  const models = new Set<NonNullable<Order["payoutModel"]>>();
  const observedModels = new Set<string>();
  const ledgerIds = new Set<string>();
  const orderIds = new Set<string>();
  const invoiceIds = new Set<string>();

  function compareIdentity(actual: string | null, expected: string) {
    if (!isId(actual)) missing.add("incomplete_evidence");
    else if (actual !== expected) conflicts.add("identity_mismatch");
  }

  function recordAccount(account: string | null) {
    if (!isId(account)) missing.add("incomplete_evidence");
    else accounts.add(account);
  }

  const subscription = input.subscription.data;
  if (!subscription) missing.add("subscription_missing");
  else {
    compareIdentity(subscription.id, target.subscriptionId);
    compareIdentity(subscription.stripe_subscription_id, target.subscriptionId);
    compareIdentity(subscription.user_id, target.userId);
    compareIdentity(subscription.course_id, target.courseId);
    compareIdentity(subscription.teacher_id, target.teacherId);
  }

  const ordersById = new Map<string, LegacyOrderEvidence[]>();
  for (const order of input.orders.data) {
    const rows = ordersById.get(order.id) ?? [];
    rows.push(order);
    ordersById.set(order.id, rows);
  }

  const exactLedger = input.ledger.data.filter((row) => row.subscription_id === target.subscriptionId);
  if (!exactLedger.length) missing.add("no_exact_ledger");

  for (const row of exactLedger) {
    if (isId(row.id)) ledgerIds.add(row.id);
    else missing.add("incomplete_evidence");
    if (!isId(row.kind)) missing.add("incomplete_evidence");
    else if (row.kind !== "course_subscription") conflicts.add("ledger_kind_mismatch");
    compareIdentity(row.course_id, target.courseId);
    compareIdentity(row.teacher_id, target.teacherId);
    recordAccount(row.teacher_stripe_connected_account_id);

    // No writer legado, a fatura e a identidade do pedido; nao juntar so por partes.
    if (!isId(row.order_id) || !isId(row.invoice_id)) missing.add("incomplete_evidence");
    if (isId(row.invoice_id)) invoiceIds.add(row.invoice_id);
    if (isId(row.order_id) && isId(row.invoice_id) && row.order_id !== row.invoice_id) {
      conflicts.add("invoice_order_mismatch");
    }

    // Uma fatura/pedido nao pode provar duas assinaturas, mesmo em entrada repetida.
    for (const other of input.ledger.data) {
      const sharesLink = (isId(row.id) && other.id === row.id) ||
        (isId(row.order_id) && (other.order_id === row.order_id || other.invoice_id === row.order_id)) ||
        (isId(row.invoice_id) && (other.invoice_id === row.invoice_id || other.order_id === row.invoice_id));
      if (!sharesLink) continue;
      if (!isId(other.subscription_id)) missing.add("incomplete_evidence");
      else if (other.subscription_id !== target.subscriptionId) conflicts.add("subscription_link_mismatch");
      if (other.id === row.id &&
        (other.order_id !== row.order_id || other.invoice_id !== row.invoice_id)) {
        conflicts.add("invoice_order_mismatch");
      }
    }

    if (!isId(row.order_id)) continue;
    const orders = ordersById.get(row.order_id);
    if (!orders?.length) {
      missing.add("order_missing");
      continue;
    }
    orderIds.add(row.order_id);
    for (const order of orders) {
      compareIdentity(order.user_id, target.userId);
      compareIdentity(order.course_id, target.courseId);
      compareIdentity(order.teacher_id, target.teacherId);
      recordAccount(order.teacher_stripe_connected_account_id);
      if (!isId(order.provider)) missing.add("incomplete_evidence");
      else if (order.provider !== "stripe") conflicts.add("provider_mismatch");
      if (!isId(order.payout_model)) missing.add("incomplete_evidence");
      else {
        observedModels.add(order.payout_model);
        if (isPayoutModel(order.payout_model)) models.add(order.payout_model);
        else missing.add("unknown_model");
      }
    }
  }

  if (accounts.size > 1) conflicts.add("account_mismatch");
  if (observedModels.size > 1) conflicts.add("model_mismatch");
  if (conflicts.size) return { status: "conflict", reasons: [...conflicts].sort() };
  if (missing.size) return { status: "missing", reasons: [...missing].sort() };

  const [teacherConnectedAccountId] = accounts;
  const [payoutModel] = models;
  if (!teacherConnectedAccountId || !payoutModel) {
    return { status: "missing", reasons: ["incomplete_evidence"] };
  }
  return {
    status: "resolved",
    candidate: {
      subscriptionId: target.subscriptionId,
      userId: target.userId,
      courseId: target.courseId,
      teacherId: target.teacherId,
      teacherConnectedAccountId,
      payoutModel,
    },
    verification: "local_evidence_only",
    evidence: {
      ledgerIds: [...ledgerIds].sort(),
      orderIds: [...orderIds].sort(),
      invoiceIds: [...invoiceIds].sort(),
    },
  };
}
