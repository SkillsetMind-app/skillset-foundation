import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
  reversalCreate: vi.fn(),
  subscriptionRetrieve: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/stripe", () => ({
  getStripeClient: mocks.getStripe,
  isStripeConfigured: mocks.isStripeConfigured,
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import { ACTIVATION_FEE_CHECKOUT_PURPOSE } from "@/data/plans";

type FailurePoint =
  | "payments.upsert"
  | "orders.update"
  | "enrollments.insert"
  | "payout_ledger.insert"
  | "course_subscriptions.update";

type RefundClaim = {
  state: "pending" | "done";
  plannedAmountMinor: number;
};

type AdminState = {
  mode: "checkout" | "refund";
  failAt?: FailurePoint;
  // Opt-in: the plan subscription row does not exist yet, so its UPDATE matches
  // zero rows (a silent success in PostgREST).
  planRowMissing?: boolean;
  doneEvents: Set<string>;
  refundClaims: Record<string, RefundClaim>;
  ledger: Record<string, unknown>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  userUpdates: Array<Record<string, unknown>>;
  enrollmentUpdates: Array<Record<string, unknown>>;
};

type Filter = { column: string; value: unknown };

function baseLedger() {
  return {
    id: "order_1",
    status: "released",
    kind: "course_one_time",
    subscription_id: null,
    transfer_id: "tr_1",
    transfer_amount_minor: 8000,
    gross_amount_minor: 10000,
    net_amount_minor: 8000,
    transfer_reversed_amount_minor: 0,
    refund_reversal_claims: {},
    order_id: "order_1",
    course_id: "course_1",
    teacher_id: "teacher_1",
  };
}

function createAdmin(
  mode: AdminState["mode"],
  failAt?: FailurePoint,
  planRowMissing?: boolean,
) {
  const state: AdminState = {
    mode,
    failAt,
    planRowMissing,
    doneEvents: new Set(),
    refundClaims: {},
    ledger: baseLedger(),
    rpcCalls: [],
    userUpdates: [],
    enrollmentUpdates: [],
  };

  class Query {
    private operation: "select" | "upsert" | "update" | "insert" | "delete" =
      "select";
    private values: Record<string, unknown> = {};
    private filters: Filter[] = [];

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    upsert(values: Record<string, unknown>) {
      this.operation = "upsert";
      this.values = values;
      return this;
    }

    update(values: Record<string, unknown>) {
      this.operation = "update";
      this.values = values;
      return this;
    }

    insert(values: Record<string, unknown>) {
      this.operation = "insert";
      this.values = values;
      return this;
    }

    delete() {
      this.operation = "delete";
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    // Same filter semantics as eq for this fake; the activation-fee stamp uses
    // .is(column, null) to stay idempotent.
    is(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    limit() {
      return this;
    }

    maybeSingle() {
      return Promise.resolve(this.evaluate(true));
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(this.evaluate(false)).then(onfulfilled, onrejected);
    }

    private filterValue(column: string) {
      return this.filters.find((filter) => filter.column === column)?.value;
    }

    private evaluate(single: boolean) {
      if (this.operation !== "select") {
        const point = `${this.table}.${this.operation}`;
        if (state.failAt === point) {
          return { data: null, error: { message: `forced ${point} failure` } };
        }

        if (this.table === "processed_stripe_events") {
          const eventId = String(
            this.values.stripe_event_id ?? this.filterValue("stripe_event_id") ?? "",
          );
          if (this.operation === "update" && this.values.status === "done") {
            state.doneEvents.add(eventId);
          }
          return {
            data:
              this.operation === "upsert"
                ? [{ stripe_event_id: eventId }]
                : null,
            error: null,
          };
        }

        if (
          state.mode === "refund" &&
          this.table === "payout_ledger" &&
          this.filterValue("id") === "order_1" &&
          this.operation === "update"
        ) {
          Object.assign(state.ledger, this.values);
        }

        if (this.table === "enrollments" && this.operation === "update") {
          state.enrollmentUpdates.push({
            ...this.values,
            id: this.filterValue("id"),
          });
        }

        if (this.table === "users" && this.operation === "update") {
          state.userUpdates.push({
            ...this.values,
            stripe_connected_account_id: this.filterValue(
              "stripe_connected_account_id",
            ),
          });
        }

        // The plan past_due write reads its row back, so it needs a real row
        // here -- the default null below is exactly the zero-row case it guards.
        if (this.table === "subscriptions" && this.operation === "update") {
          return {
            data: state.planRowMissing ? null : { id: this.filterValue("id") },
            error: null,
          };
        }

        return { data: null, error: null };
      }

      let data: Record<string, unknown> | null = null;
      if (this.table === "orders") {
        data = {
          id: "order_1",
          user_id: "user_1",
          course_id: "course_1",
          teacher_id: "teacher_1",
          amount_minor: 10000,
          currency: "USD",
          platform_fee_bps: 1000,
          status: "pending",
        };
      } else if (this.table === "courses") {
        data = {
          id: "course_1",
          owner_id: "teacher_1",
          title: "Course",
          category: "Clinical Psychology & Approaches",
          cover_image_url: null,
          stripe_connected_account_id: "acct_teacher",
        };
      } else if (this.table === "payments" && state.mode === "refund") {
        data = {
          id: "pi_1",
          order_id: "order_1",
          user_id: "user_1",
          course_id: "course_1",
        };
      } else if (this.table === "payout_ledger" && state.mode === "refund") {
        // Refunds resolve the ledger by id; disputes only know the payment
        // intent, so they look it up by payment_id.
        const matched =
          this.filterValue("id") === "order_1"
          || this.filterValue("payment_id") === "pi_1";
        data = matched ? { ...state.ledger } : null;
      }

      return {
        data: single ? data : data ? [data] : [],
        error: null,
      };
    }
  }

  const admin = {
    from: vi.fn((table: string) => new Query(table)),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "claim_payout_transfer_reversal") {
        const claimKey = String(args.p_claim_key);
        const existing = state.refundClaims[claimKey];
        if (existing?.state === "done") {
          return {
            data: {
              claimKey,
              state: "done",
              plannedAmountMinor: existing.plannedAmountMinor,
              shouldExecute: false,
              redelivery: true,
              action: "skip",
              planned_amount_minor: 0,
            },
            error: null,
          };
        }
        if (existing?.state === "pending") {
          return {
            data: {
              claimKey,
              state: "pending",
              plannedAmountMinor: existing.plannedAmountMinor,
              shouldExecute: true,
              redelivery: true,
              action: "execute",
              planned_amount_minor: existing.plannedAmountMinor,
            },
            error: null,
          };
        }

        const target = Number(args.p_target_amount_minor || 0);
        const reversed = Number(state.ledger.transfer_reversed_amount_minor || 0);
        const planned = Math.max(0, target - reversed);
        if (planned <= 0) {
          return {
            data: {
              claimKey,
              state: "done",
              plannedAmountMinor: 0,
              targetAmountMinor: target,
              shouldExecute: false,
              redelivery: false,
              action: "skip",
              planned_amount_minor: 0,
            },
            error: null,
          };
        }

        state.refundClaims[claimKey] = {
          state: "pending",
          plannedAmountMinor: planned,
        };
        state.ledger.transfer_reversed_amount_minor = reversed + planned;
        return {
          data: {
            claimKey,
            state: "pending",
            plannedAmountMinor: planned,
            targetAmountMinor: target,
            shouldExecute: true,
            redelivery: false,
            action: "execute",
            planned_amount_minor: planned,
          },
          error: null,
        };
      }

      if (name === "complete_payout_transfer_reversal") {
        const claimKey = String(args.p_claim_key);
        const claim = state.refundClaims[claimKey];
        if (claim?.state === "pending") {
          claim.state = "done";
        }
      }

      return { data: null, error: null };
    }),
    state,
  };

  return admin;
}

function checkoutEvent() {
  return {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_1",
        metadata: {
          orderId: "order_1",
          courseId: "course_1",
          userId: "user_1",
          teacherId: "teacher_1",
        },
      },
    },
  };
}

function refundEvent(eventId: string, refundedAmountMinor: number) {
  return {
    id: eventId,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_1",
        payment_intent: "pi_1",
        amount: 10000,
        amount_refunded: refundedAmountMinor,
        refunded: false,
      },
    },
  };
}

function failedInvoiceEvent() {
  return {
    id: "evt_invoice_failed",
    type: "invoice.payment_failed",
    account: "acct_teacher",
    data: {
      object: {
        id: "in_1",
        parent: {
          subscription_details: { subscription: "sub_1" },
        },
      },
    },
  };
}

// Plan subscriptions live on the platform, so their events carry no `account`.
function failedPlanInvoiceEvent() {
  return {
    id: "evt_plan_invoice_failed",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_plan_1",
        parent: {
          subscription_details: { subscription: "sub_plan_1" },
        },
      },
    },
  };
}

function paidInvoiceEvent() {
  return {
    id: "evt_invoice_paid",
    type: "invoice.paid",
    account: "acct_teacher",
    data: {
      object: {
        id: "in_paid_1",
        amount_paid: 10_000,
        currency: "usd",
        payment_intent: "pi_paid_1",
        parent: {
          subscription_details: { subscription: "sub_1" },
        },
      },
    },
  };
}

// A one-time activation fee session. It deliberately carries NO orderId /
// courseId / userId: those belong to course sales, and their absence is exactly
// what used to wedge this webhook when mode was "payment" rather than
// "subscription".
function activationFeeEvent() {
  return {
    id: "evt_activation",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_activation_1",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_activation_1",
        metadata: {
          uid: "teacher_1",
          purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE,
        },
      },
    },
  };
}

// A refund of the activation fee. It is a PLATFORM charge, so it has no row in
// `payments` and no payout_ledger entry — the handler must recognise it by
// metadata alone, which Stripe copies from the PaymentIntent onto the charge.
function activationRefundEvent() {
  return {
    id: "evt_activation_refund",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_activation_1",
        payment_intent: "pi_activation_1",
        amount: 2500,
        amount_refunded: 2500,
        currency: "usd",
        refunded: true,
        metadata: {
          uid: "teacher_1",
          purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE,
        },
      },
    },
  };
}

async function postEvent(event: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "test_signature" },
      body: JSON.stringify(event),
    }),
  );
}

describe("Stripe webhook financial integrity", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_test";
    mocks.getAdmin.mockReset();
    mocks.reversalCreate.mockReset().mockResolvedValue({ id: "trr_1" });
    mocks.subscriptionRetrieve.mockReset().mockResolvedValue({
      metadata: { purpose: "course_subscription" },
    });
    mocks.isStripeConfigured.mockReturnValue(true);
    mocks.getStripe.mockReset().mockReturnValue({
      webhooks: {
        constructEvent: (rawBody: string) => JSON.parse(rawBody),
      },
      paymentIntents: {
        retrieve: vi.fn().mockResolvedValue({ latest_charge: null }),
      },
      transfers: {
        createReversal: mocks.reversalCreate,
      },
      subscriptions: {
        retrieve: mocks.subscriptionRetrieve,
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it.each<FailurePoint>([
    "payments.upsert",
    "orders.update",
    "enrollments.insert",
    "payout_ledger.insert",
  ])("returns 500 and leaves the event retryable when %s fails", async (failAt) => {
    const admin = createAdmin("checkout", failAt);
    mocks.getAdmin.mockReturnValue(admin);

    const response = await postEvent(checkoutEvent());

    expect(response.status).toBe(500);
    expect(admin.state.doneEvents).not.toContain("evt_checkout");
  });

  it("stamps the activation fee instead of routing it through course fulfilment", async () => {
    const admin = createAdmin("checkout");
    mocks.getAdmin.mockReturnValue(admin);

    const response = await postEvent(activationFeeEvent());

    // A 500 here means the session fell into handleCheckoutCompleted, which
    // throws on the missing order metadata and leaves Stripe retrying forever.
    expect(response.status).toBe(200);
    expect(admin.state.doneEvents).toContain("evt_activation");
    expect(admin.state.userUpdates).toHaveLength(1);
    expect(admin.state.userUpdates[0].activation_fee_paid_at).toEqual(
      expect.any(String),
    );
    expect(admin.state.rpcCalls).toContainEqual({
      name: "log_audit_event",
      args: expect.objectContaining({
        p_action: "STOREFRONT_ACTIVATION_FEE_PAID",
        p_target_id: "teacher_1",
        p_metadata: expect.objectContaining({ checkoutSessionId: "cs_activation_1" }),
      }),
    });
  });

  it("revokes the storefront when the activation fee is fully refunded", async () => {
    // "checkout" mode on purpose: there is no payments row for this charge, so
    // without the metadata branch the handler falls through and returns silently
    // — the creator keeps a storefront they were refunded for.
    const admin = createAdmin("checkout");
    mocks.getAdmin.mockReturnValue(admin);

    const response = await postEvent(activationRefundEvent());

    expect(response.status).toBe(200);
    expect(admin.state.userUpdates).toHaveLength(1);
    expect(admin.state.userUpdates[0].activation_fee_paid_at).toBeNull();
    expect(admin.state.rpcCalls).toContainEqual({
      name: "log_audit_event",
      args: expect.objectContaining({
        p_action: "STOREFRONT_ACTIVATION_FEE_REFUNDED",
        p_target_id: "teacher_1",
      }),
    });
  });

  it("keeps the storefront when the activation fee is only partially refunded", async () => {
    const admin = createAdmin("checkout");
    mocks.getAdmin.mockReturnValue(admin);
    const event = activationRefundEvent();
    (event.data.object as Record<string, unknown>).refunded = false;
    (event.data.object as Record<string, unknown>).amount_refunded = 500;

    const response = await postEvent(event);

    expect(response.status).toBe(200);
    expect(admin.state.userUpdates).toHaveLength(0);
  });

  it("does not swallow a failed course subscription status write", async () => {
    const admin = createAdmin("checkout", "course_subscriptions.update");
    mocks.getAdmin.mockReturnValue(admin);

    const response = await postEvent(failedInvoiceEvent());

    expect(response.status).toBe(500);
    expect(mocks.subscriptionRetrieve).toHaveBeenCalledWith(
      "sub_1",
      undefined,
      { stripeAccount: "acct_teacher" },
    );
    expect(admin.state.doneEvents).not.toContain("evt_invoice_failed");
  });

  it("marks a plan subscription past due", async () => {
    const admin = createAdmin("checkout");
    mocks.getAdmin.mockReturnValue(admin);
    mocks.subscriptionRetrieve.mockResolvedValueOnce({ metadata: {} });

    const response = await postEvent(failedPlanInvoiceEvent());

    expect(response.status).toBe(200);
    expect(mocks.subscriptionRetrieve).toHaveBeenCalledWith(
      "sub_plan_1",
      undefined,
      undefined,
    );
    expect(admin.state.doneEvents).toContain("evt_plan_invoice_failed");
  });

  // Control for the test above: same setup, one input flipped.
  it("retries when the plan subscription row does not exist yet", async () => {
    const admin = createAdmin("checkout", undefined, true);
    mocks.getAdmin.mockReturnValue(admin);
    mocks.subscriptionRetrieve.mockResolvedValueOnce({ metadata: {} });

    const response = await postEvent(failedPlanInvoiceEvent());

    expect(response.status).toBe(500);
    expect(admin.state.doneEvents).not.toContain("evt_plan_invoice_failed");
  });

  // Control for the retry above: a deleted subscription is terminal, so the
  // same missing row must NOT retry -- otherwise Stripe loops until it gives up.
  it("does not retry when Stripe already deleted the subscription", async () => {
    const admin = createAdmin("checkout", undefined, true);
    mocks.getAdmin.mockReturnValue(admin);
    mocks.subscriptionRetrieve.mockRejectedValueOnce(
      Object.assign(new Error("No such subscription"), {
        code: "resource_missing",
      }),
    );

    const response = await postEvent(failedPlanInvoiceEvent());

    expect(response.status).toBe(200);
    expect(admin.state.doneEvents).toContain("evt_plan_invoice_failed");
  });

  it("fulfils a paid course renewal on the connected account", async () => {
    const admin = createAdmin("checkout");
    mocks.getAdmin.mockReturnValue(admin);
    mocks.subscriptionRetrieve.mockResolvedValueOnce({
      metadata: {
        purpose: "course_subscription",
        courseId: "course_1",
        userId: "user_1",
        teacherId: "teacher_1",
      },
      items: { data: [{ current_period_end: 1_800_000_000 }] },
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
    });

    const response = await postEvent(paidInvoiceEvent());

    expect(response.status).toBe(200);
    expect(mocks.subscriptionRetrieve).toHaveBeenCalledWith(
      "sub_1",
      undefined,
      { stripeAccount: "acct_teacher" },
    );
    expect(admin.state.doneEvents).toContain("evt_invoice_paid");
  });

  it("syncs connected-account readiness from a Connect webhook", async () => {
    const admin = createAdmin("checkout");
    mocks.getAdmin.mockReturnValue(admin);

    const response = await postEvent({
      id: "evt_account_updated",
      type: "account.updated",
      account: "acct_teacher",
      data: {
        object: {
          id: "acct_teacher",
          object: "account",
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(admin.state.userUpdates).toContainEqual(
      expect.objectContaining({
        stripe_connected_account_id: "acct_teacher",
        stripe_connect_status: "ready",
        stripe_connect_charges_enabled: true,
        stripe_connect_payouts_enabled: true,
      }),
    );
  });

  it("records refunds without moving any money (direct-charge invariant)", async () => {
    // Under direct charges the platform holds nothing: Stripe debits the refund
    // straight from the teacher's balance. The webhook must therefore NEVER
    // call transfers.createReversal — if it ever does again, we are back to
    // being a custodian of other people's money.
    const admin = createAdmin("refund");
    mocks.getAdmin.mockReturnValue(admin);

    const responses = await Promise.all([
      postEvent(refundEvent("evt_refund_30", 3000)),
      postEvent(refundEvent("evt_refund_60", 6000)),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.reversalCreate).not.toHaveBeenCalled();
    expect(
      admin.state.rpcCalls.filter(
        (call) => call.name === "claim_payout_transfer_reversal",
      ),
    ).toHaveLength(0);
  });

  function disputeClosedEvent(id: string, status: string) {
    return {
      id,
      type: "charge.dispute.closed",
      data: { object: { id: "dp_1", status, payment_intent: "pi_1" } },
    };
  }

  // "disputed" is the normal path (dispute.created was processed first).
  // "released" is a missed dispute.created: nextLedgerStatusOnDispute returns
  // null there, so if the revoke sat behind that guard the buyer would keep a
  // course they were fully charged back for.
  it.each(["disputed", "released"])(
    "revokes the enrollment when a chargeback is lost (ledger %s)",
    async (ledgerStatus) => {
      const admin = createAdmin("refund");
      admin.state.ledger.status = ledgerStatus;
      mocks.getAdmin.mockReturnValue(admin);

      const response = await postEvent(
        disputeClosedEvent(`evt_dispute_lost_${ledgerStatus}`, "lost"),
      );

      expect(response.status).toBe(200);
      expect(admin.state.enrollmentUpdates).toContainEqual(
        expect.objectContaining({ id: "user_1__course_1", status: "refunded" }),
      );
    },
  );

  it("keeps the enrollment when the dispute is won", async () => {
    // Control: without this the test above would pass even if the handler
    // revoked on every closed dispute.
    const admin = createAdmin("refund");
    admin.state.ledger.status = "disputed";
    mocks.getAdmin.mockReturnValue(admin);

    const response = await postEvent(disputeClosedEvent("evt_dispute_won", "won"));

    expect(response.status).toBe(200);
    expect(admin.state.enrollmentUpdates).toEqual([]);
    expect(admin.state.ledger.status).toBe("settled");
  });
});
