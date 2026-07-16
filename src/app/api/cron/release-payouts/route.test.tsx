import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
  transferCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/stripe", () => ({
  getStripeClient: mocks.getStripe,
  isStripeConfigured: mocks.isStripeConfigured,
}));

import { GET } from "@/app/api/cron/release-payouts/route";

type LedgerRecord = {
  id: string;
  status: string;
  release_at: string;
  teacher_stripe_connected_account_id: string;
  currency: string;
  gross_amount_minor: number;
  net_amount_minor: number;
  refunded_amount_minor: number;
  planned_transfer_amount_minor: number | null;
  transfer_reversed_amount_minor: number;
  order_id: string;
  course_id: string;
  teacher_id: string;
  payment_id: string;
  transfer_id?: string | null;
  transfer_amount_minor?: number;
  updated_at?: string;
};

type Filter = {
  operator: "eq" | "lt" | "lte";
  column: string;
  value: unknown;
};

function baseLedger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    id: "ledger_1",
    status: "in_release",
    release_at: "2020-01-01T00:00:00.000Z",
    teacher_stripe_connected_account_id: "acct_teacher",
    currency: "USD",
    gross_amount_minor: 10000,
    net_amount_minor: 8000,
    refunded_amount_minor: 0,
    planned_transfer_amount_minor: null,
    transfer_reversed_amount_minor: 0,
    order_id: "order_1",
    course_id: "course_1",
    teacher_id: "teacher_1",
    payment_id: "pi_1",
    ...overrides,
  };
}

function createPayoutAdmin(input: {
  ledger: LedgerRecord;
  mutateAfterDueSelection?: (ledger: LedgerRecord) => void;
}) {
  const ledger = input.ledger;
  let dueSelectionCompleted = false;

  class Query {
    private operation: "select" | "update" | null = null;
    private updateValues: Partial<LedgerRecord> = {};
    private filters: Filter[] = [];

    select() {
      if (this.operation === null) this.operation = "select";
      return this;
    }

    update(values: Partial<LedgerRecord>) {
      this.operation = "update";
      this.updateValues = values;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ operator: "eq", column, value });
      return this;
    }

    lt(column: string, value: unknown) {
      this.filters.push({ operator: "lt", column, value });
      return this;
    }

    lte(column: string, value: unknown) {
      this.filters.push({ operator: "lte", column, value });
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

    private matches(): boolean {
      return this.filters.every((filter) => {
        const actual = ledger[filter.column as keyof LedgerRecord];
        if (filter.operator === "eq") return actual === filter.value;
        if (filter.operator === "lt") return String(actual) < String(filter.value);
        return String(actual) <= String(filter.value);
      });
    }

    private evaluate(single: boolean) {
      const matches = this.matches();
      if (this.operation === "update") {
        if (matches) Object.assign(ledger, this.updateValues);
        return { data: single ? (matches ? { ...ledger } : null) : matches ? [{ ...ledger }] : [], error: null };
      }

      const rows = matches ? [{ ...ledger }] : [];
      const isDueSelection = this.filters.some(
        (filter) => filter.column === "release_at" && filter.operator === "lte",
      );
      if (isDueSelection && !dueSelectionCompleted) {
        dueSelectionCompleted = true;
        input.mutateAfterDueSelection?.(ledger);
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
  }

  return {
    from: vi.fn(() => new Query()),
    ledger,
  };
}

async function runCron() {
  return GET(
    new Request("http://localhost/api/cron/release-payouts", {
      headers: { authorization: "Bearer test-cron-secret" },
    }),
  );
}

describe("release-payouts refund race", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    mocks.transferCreate.mockReset().mockResolvedValue({ id: "tr_1" });
    mocks.getStripe.mockReset().mockReturnValue({
      transfers: {
        create: mocks.transferCreate,
        createReversal: vi.fn(),
      },
    });
    mocks.getAdmin.mockReset();
    mocks.isStripeConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("does not claim or transfer when refunded_amount_minor changed after selection", async () => {
    const admin = createPayoutAdmin({
      ledger: baseLedger(),
      mutateAfterDueSelection: (ledger) => {
        ledger.refunded_amount_minor = 2000;
      },
    });
    mocks.getAdmin.mockReturnValue(admin);

    const response = await runCron();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ released: 0, skipped: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(admin.ledger.status).toBe("in_release");
  });

  it("keeps an already frozen planned amount when the current refund suggests less", async () => {
    const admin = createPayoutAdmin({
      ledger: baseLedger({
        refunded_amount_minor: 2000,
        planned_transfer_amount_minor: 8000,
      }),
    });
    mocks.getAdmin.mockReturnValue(admin);

    const response = await runCron();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ released: 1, skipped: 0 });
    expect(mocks.transferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000 }),
      { idempotencyKey: "transfer_ledger_1" },
    );
    expect(admin.ledger.planned_transfer_amount_minor).toBe(8000);
  });

  it("reuses the frozen amount when an ambiguous Stripe failure is retried after a refund", async () => {
    const admin = createPayoutAdmin({ ledger: baseLedger() });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.transferCreate
      .mockRejectedValueOnce(new Error("connection reset after transfer"))
      .mockResolvedValueOnce({ id: "tr_1" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const firstResponse = await runCron();

    expect(await firstResponse.json()).toMatchObject({ released: 0, failed: 1 });
    expect(admin.ledger.planned_transfer_amount_minor).toBe(8000);

    admin.ledger.refunded_amount_minor = 2000;
    const retryResponse = await runCron();

    expect(await retryResponse.json()).toMatchObject({ released: 1, failed: 0 });
    expect(mocks.transferCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ amount: 8000 }),
      { idempotencyKey: "transfer_ledger_1" },
    );
    expect(mocks.transferCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ amount: 8000 }),
      { idempotencyKey: "transfer_ledger_1" },
    );
    expect(admin.ledger.planned_transfer_amount_minor).toBe(8000);
  });
});
