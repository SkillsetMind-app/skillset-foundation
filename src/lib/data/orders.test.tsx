import { describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import { subscribeToTeacherCourseSubscriptions } from "@/lib/data/course-subscriptions";
import {
  mapOrderRow,
  subscribeToTeacherOrders,
} from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import type { Database } from "@/lib/supabase/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

describe("mapOrderRow", () => {
  it("preserves authorization and financial detail fields", () => {
    const row: OrderRow = {
      amount_minor: 24900,
      checkout_session_id: "cs_123",
      coupon_code: null,
      course_id: "course-1",
      course_slug: "clinical-performance",
      course_title: "Clinical Performance",
      created_at: "2026-07-15T10:00:00.000Z",
      currency: "brl",
      discount_minor: 0,
      id: "order-1",
      latest_transfer_reversal_at: null,
      latest_transfer_reversal_id: null,
      paid_at: "2026-07-15T10:01:00.000Z",
      offer_id: null,
      payment_intent_id: "pi_123",
      payout_model: "destination_charge",
      platform_fee_bps: 950,
      price_id: null,
      provider: "stripe",
      receipt_url: "https://pay.example/receipt/1",
      refund_request_id: null,
      refund_requested_at: null,
      refunded_amount_minor: 4900,
      status: "partially_refunded",
      teacher_id: "teacher-1",
      teacher_stripe_connected_account_id: "acct_123",
      transfer_reversed_amount_minor: 4900,
      updated_at: "2026-07-15T11:00:00.000Z",
      user_id: "learner-1",
    };

    expect(mapOrderRow(row)).toMatchObject({
      id: "order-1",
      teacherId: "teacher-1",
      teacherStripeConnectedAccountId: "acct_123",
      refundedAmountMinor: 4900,
      receiptUrl: "https://pay.example/receipt/1",
      paidAt: "2026-07-15T10:01:00.000Z",
      updatedAt: "2026-07-15T11:00:00.000Z",
      payoutModel: "destination_charge",
    });
  });
});

type Page = {
  data: Array<Record<string, unknown>> | null;
  error: Error | null;
};

type TeacherRowsSubscription = (
  teacherId: string,
  callback: (rows: unknown[]) => void,
  onError: (error: Error) => void,
) => () => void;

function createSupabaseClient(pagesByTable: Record<string, Page[]>) {
  const pageIndexes = new Map<string, number>();
  const rangeCalls = vi.fn();
  const orderCalls = vi.fn();
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);

  const client = {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
        range: vi.fn(),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.order.mockImplementation((column: string) => {
        orderCalls(table, column);
        return query;
      });
      query.limit.mockImplementation(async () => {
        return pagesByTable[table]?.[0] ?? { data: [], error: null };
      });
      query.range.mockImplementation(async (from: number, to: number) => {
        rangeCalls(table, from, to);
        const index = pageIndexes.get(table) ?? 0;
        pageIndexes.set(table, index + 1);
        return pagesByTable[table]?.[index] ?? { data: [], error: null };
      });
      return query;
    }),
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };

  return { client, orderCalls, rangeCalls };
}

function makeOrderRow(index: number): Record<string, unknown> {
  return {
    amount_minor: 100,
    checkout_session_id: null,
    course_id: "course-1",
    course_slug: "course-1",
    course_title: "Course",
    created_at: `2026-07-15T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
    currency: "USD",
    id: `order-${String(index).padStart(4, "0")}`,
    paid_at: null,
    payment_intent_id: null,
    payout_model: "separate_charges_and_transfers",
    platform_fee_bps: 800,
    provider: "stripe",
    receipt_url: null,
    refunded_amount_minor: 0,
    status: "paid",
    teacher_id: "teacher-1",
    teacher_stripe_connected_account_id: "acct-1",
    updated_at: "2026-07-15T10:00:00.000Z",
    user_id: "learner-1",
  };
}

function makePayoutRow(index: number): Record<string, unknown> {
  return {
    course_id: "course-1",
    created_at: "2026-07-15T10:00:00.000Z",
    currency: "USD",
    gross_amount_minor: 100,
    id: `ledger-${String(index).padStart(4, "0")}`,
    net_amount_minor: 80,
    order_id: `order-${index}`,
    payment_id: `payment-${index}`,
    platform_fee_bps: 800,
    refunded_amount_minor: 0,
    release_at: null,
    skillset_fee_minor: 8,
    status: "in_release",
    stripe_fee_minor: 12,
    teacher_id: "teacher-1",
    updated_at: "2026-07-15T10:00:00.000Z",
  };
}

function makeSubscriptionRow(index: number): Record<string, unknown> {
  return {
    cancel_at_period_end: false,
    course_id: "course-1",
    course_slug: "course-1",
    created_at: "2026-07-15T10:00:00.000Z",
    currency: "USD",
    current_period_end: null,
    id: `subscription-${String(index).padStart(4, "0")}`,
    interval: "month",
    latest_invoice_id: `invoice-${index}`,
    offer_id: "offer-1",
    past_due: false,
    price_amount_minor: 100,
    price_id: "price-1",
    status: "active",
    stripe_customer_id: `customer-${index}`,
    stripe_subscription_id: `subscription-${index}`,
    teacher_id: "teacher-1",
    updated_at: "2026-07-15T10:00:00.000Z",
    user_id: `learner-${index}`,
  };
}

describe("teacher financial subscriptions", () => {
  const cases: Array<{
    label: string;
    table: string;
    subscribe: TeacherRowsSubscription;
    makeRow: (index: number) => Record<string, unknown>;
  }> = [
    {
      label: "orders",
      table: "orders",
      subscribe: subscribeToTeacherOrders as unknown as TeacherRowsSubscription,
      makeRow: makeOrderRow,
    },
    {
      label: "payout ledger",
      table: "payout_ledger",
      subscribe: subscribeToTeacherPayoutLedger as unknown as TeacherRowsSubscription,
      makeRow: makePayoutRow,
    },
    {
      label: "course subscriptions",
      table: "course_subscriptions",
      subscribe:
        subscribeToTeacherCourseSubscriptions as unknown as TeacherRowsSubscription,
      makeRow: makeSubscriptionRow,
    },
  ];

  it.each(cases)("paginates every $label row past 500", async ({
    table,
    subscribe,
    makeRow,
  }) => {
    const firstPage = Array.from({ length: 500 }, (_, index) => makeRow(index));
    const secondPage = [makeRow(500)];
    const { client, orderCalls, rangeCalls } = createSupabaseClient({
      [table]: [
        { data: firstPage, error: null },
        { data: secondPage, error: null },
      ],
    });
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    const callback = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribe("teacher-1", callback, onError);

    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback.mock.calls[0]?.[0]).toHaveLength(501);
    expect(onError).not.toHaveBeenCalled();
    expect(orderCalls).toHaveBeenCalledWith(table, "created_at");
    expect(orderCalls).toHaveBeenCalledWith(table, "id");
    expect(rangeCalls).toHaveBeenNthCalledWith(1, table, 0, 499);
    expect(rangeCalls).toHaveBeenNthCalledWith(2, table, 500, 999);
    unsubscribe();
  });

  it.each(cases)("does not publish partial $label rows after a later page fails", async ({
    table,
    subscribe,
    makeRow,
  }) => {
    const firstPage = Array.from({ length: 500 }, (_, index) => makeRow(index));
    const readError = new Error(`${table} page 2 failed`);
    const { client } = createSupabaseClient({
      [table]: [
        { data: firstPage, error: null },
        { data: null, error: readError },
      ],
    });
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    const callback = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribe("teacher-1", callback, onError);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(readError));
    expect(callback).not.toHaveBeenCalled();
    unsubscribe();
  });
});
