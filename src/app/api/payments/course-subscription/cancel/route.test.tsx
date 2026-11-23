import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  requireUserId: vi.fn(),
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  getUserRow: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  fetch: vi.fn(),
  notifyOps: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  enforceRateLimit: mocks.enforceRateLimit,
  requireUserId: mocks.requireUserId,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/stripe", () => ({
  getStripeClient: mocks.getStripe,
  StripeConfigError: class StripeConfigError extends Error {},
}));

vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  getUserRow: mocks.getUserRow,
}));

vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));

import { POST } from "@/app/api/payments/course-subscription/cancel/route";
import { PaymentError } from "@/lib/payments/server/auth";

type Row = Record<string, unknown>;
type Table = "enrollments" | "payout_ledger" | "course_subscriptions" | "orders" | "courses";
type Filter = { operator: "eq" | "not"; column: string; value: unknown };
type QueryTrace = {
  table: Table;
  operation: "select" | "update";
  filters: Filter[];
  ordering: { column: string; ascending: boolean; nullsFirst: boolean }[];
  limit: number | undefined;
  matchedIds: unknown[];
  values?: Row;
};
type DbError = { message: string; details: string; hint: string; code: string };
type DbReply = { data: Row | Row[] | null; error: DbError | null };
type FailureMode = "returned" | "rejected";
type ReadFailure = { matches: (query: QueryTrace) => boolean; mode: FailureMode };
type Subscription = {
  id: string;
  metadata: Record<string, string | undefined>;
  cancel_at_period_end: boolean;
  status: string;
  items: { data: { current_period_end: number }[] };
};
type AccountOptions = { stripeAccount: string } | undefined;

const internalError: DbError = {
  message: "private-db-message",
  details: "private-db-details",
  hint: "private-db-hint",
  code: "XX_PRIVATE",
};
const oldAccount = "acct_old";
const newAccount = "acct_new";
const ownerAccount = "acct_owner";
let rows: Record<Table, Row[]>;
let queries: QueryTrace[];
let events: string[];
let readFailure: ReadFailure | null;
let mirrorWriteFailure: FailureMode | null;
let subscriptions: Map<string, Subscription>;
let owners: Map<string, Row>;

function providerKey(account: string | undefined, id: string) {
  return `${account ?? "platform"}:${id}`;
}

function placeTarget(account: string | undefined) {
  for (const [key, subscription] of subscriptions) {
    if (subscription.id === "sub_old") subscriptions.delete(key);
  }
  const subscription: Subscription = {
    id: "sub_old",
    metadata: { purpose: "course_subscription", userId: "user_1", courseId: "course_1" },
    cancel_at_period_end: false,
    status: "active",
    items: { data: [{ current_period_end: 1_800_000_000 }] },
  };
  subscriptions.set(providerKey(account, "sub_old"), subscription);
  return subscription;
}

function target(...accounts: [] | [string | undefined]) {
  const account = accounts.length === 0 ? oldAccount : accounts[0];
  const subscription = subscriptions.get(providerKey(account, "sub_old"));
  if (!subscription) throw new Error("Missing test subscription");
  return subscription;
}

function ledger(overrides: Row = {}): Row {
  return {
    id: "ledger_old",
    subscription_id: "sub_old",
    course_id: "course_1",
    kind: "course_subscription",
    teacher_stripe_connected_account_id: oldAccount,
    status: "refunded",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function order(overrides: Row = {}): Row {
  return {
    id: "in_old",
    user_id: "user_1",
    course_id: "course_1",
    teacher_stripe_connected_account_id: oldAccount,
    status: "refunded",
    amount_minor: 0,
    paid_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Queries execute against fixture rows: missing filters change the result,
// rather than receiving a canned snapshot regardless of the query.
class Query {
  private operation: "select" | "update" = "select";
  private columns = "*";
  private filters: Filter[] = [];
  private ordering: QueryTrace["ordering"] = [];
  private rowLimit: number | undefined;
  private values: Row | undefined;

  constructor(private readonly table: Table) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ operator: "eq", column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) {
      throw new Error("Unsupported mock filter: implement its semantics first");
    }
    this.filters.push({ operator: "not", column, value });
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.ordering.push({
      column,
      ascending: options.ascending ?? true,
      nullsFirst: options.nullsFirst ?? false,
    });
    return this;
  }

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  update(values: Row) {
    this.operation = "update";
    this.values = values;
    return this;
  }

  maybeSingle() {
    return this.execute(true);
  }

  single() {
    return this.execute(true);
  }

  then(
    resolve: (result: DbReply) => unknown,
    reject: (reason: unknown) => unknown,
  ) {
    return this.execute(false).then(resolve, reject);
  }

  private async execute(single: boolean): Promise<DbReply> {
    let matched = rows[this.table].filter((row) =>
      this.filters.every((filter) =>
        filter.operator === "eq"
          ? row[filter.column] === filter.value
          : row[filter.column] !== null && row[filter.column] !== undefined,
      ),
    );
    matched.sort((left, right) => {
      for (const { column, ascending, nullsFirst } of this.ordering) {
        const a = left[column];
        const b = right[column];
        if (a === b) continue;
        if (a == null) return nullsFirst ? -1 : 1;
        if (b == null) return nullsFirst ? 1 : -1;
        const comparison = String(a).localeCompare(String(b));
        if (comparison !== 0) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (this.rowLimit !== undefined) matched = matched.slice(0, this.rowLimit);
    const trace: QueryTrace = {
      table: this.table,
      operation: this.operation,
      filters: [...this.filters],
      ordering: [...this.ordering],
      limit: this.rowLimit,
      matchedIds: matched.map((row) => row.id),
      ...(this.values ? { values: { ...this.values } } : {}),
    };
    queries.push(trace);
    events.push(`db:${this.operation}:${this.table}`);

    const failure = this.operation === "select" && readFailure?.matches(trace)
      ? readFailure.mode
      : this.operation === "update" && this.table === "course_subscriptions"
        ? mirrorWriteFailure
        : null;
    if (failure === "rejected") throw new Error(internalError.message);
    if (failure === "returned") return { data: null, error: internalError };

    if (this.operation === "update") {
      for (const row of matched) Object.assign(row, this.values);
      return { data: null, error: null };
    }
    if (single && matched.length > 1) {
      return {
        data: null,
        error: { ...internalError, code: "PGRST116", message: "Multiple fixture rows" },
      };
    }
    const projected = matched.map((row) => this.columns === "*"
      ? { ...row }
      : Object.fromEntries(this.columns.split(",").map((column) => {
        const key = column.trim();
        return [key, row[key]];
      })));
    return { data: single ? projected[0] ?? null : projected, error: null };
  }
}

function request(body: Row = { courseId: "course_1" }) {
  return new Request("http://localhost/api/payments/course-subscription/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reads(table: Table) {
  return queries.filter((query) => query.table === table && query.operation === "select");
}

function mirrorWrites() {
  return queries.filter((query) =>
    query.table === "course_subscriptions" && query.operation === "update");
}

function expectFilters(query: QueryTrace | undefined, values: Row) {
  expect(query).toBeDefined();
  expect(query?.filters).toEqual(expect.arrayContaining(
    Object.entries(values).map(([column, value]) => ({ operator: "eq", column, value })),
  ));
}

function withoutExactOrigins() {
  rows.payout_ledger = [];
  rows.course_subscriptions[0].latest_invoice_id = null;
}

function expectProviderScope(account: string | undefined, cancel = true) {
  const options = account ? { stripeAccount: account } : undefined;
  expect(mocks.retrieve).toHaveBeenLastCalledWith("sub_old", undefined, options);
  expect(mocks.update).toHaveBeenLastCalledWith(
    "sub_old", { cancel_at_period_end: cancel }, options,
  );
  expect(target(account).cancel_at_period_end).toBe(cancel);
  expect(subscriptions.get(providerKey(newAccount, "sub_new"))?.cancel_at_period_end).toBe(false);
  expect(rows.course_subscriptions.find((row) => row.id === "sub_new")?.cancel_at_period_end).toBe(false);
  const retrieveIndex = events.indexOf(`stripe:retrieve:${providerKey(account, "sub_old")}`);
  const updateIndex = events.indexOf(`stripe:update:${providerKey(account, "sub_old")}`);
  expect(retrieveIndex).toBeGreaterThanOrEqual(0);
  expect(updateIndex).toBeGreaterThan(retrieveIndex);
}

async function expectContextUnavailable(response: Response) {
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toEqual({
    error: expect.any(String),
    code: "subscription_context_unavailable",
  });
  for (const detail of Object.values(internalError)) {
    expect(JSON.stringify(body)).not.toContain(detail);
  }
  expect(mocks.retrieve).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mirrorWrites()).toEqual([]);
  expect([...subscriptions.values()].every((sub) => !sub.cancel_at_period_end)).toBe(true);
}

describe("course subscription cancellation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.fetch.mockRejectedValue(new Error("Network is forbidden in this test"));
    vi.stubGlobal("fetch", mocks.fetch);
    queries = [];
    events = [];
    readFailure = null;
    mirrorWriteFailure = null;
    owners = new Map([["teacher_1", { stripe_connected_account_id: ownerAccount }]]);
    rows = {
      enrollments: [
        { id: "user_2__course_1", subscription_id: "sub_new" },
        { id: "user_1__course_2", subscription_id: "sub_other_course" },
        { id: "user_1__course_1", subscription_id: "sub_old" },
      ],
      payout_ledger: [
        ledger({ id: "wrong_subscription", subscription_id: "sub_new", teacher_stripe_connected_account_id: newAccount, created_at: "2026-10-01T00:00:00.000Z" }),
        ledger({ id: "wrong_course", course_id: "course_2", teacher_stripe_connected_account_id: "acct_wrong_course", created_at: "2026-11-01T00:00:00.000Z" }),
        ledger({ id: "wrong_kind", kind: "course_purchase", teacher_stripe_connected_account_id: "acct_wrong_kind", created_at: "2026-12-01T00:00:00.000Z" }),
        ledger(),
      ],
      course_subscriptions: [
        { id: "sub_old", user_id: "user_1", course_id: "course_1", latest_invoice_id: "in_old", cancel_at_period_end: false, status: "canceled" },
        { id: "sub_new", user_id: "user_1", course_id: "course_1", latest_invoice_id: "in_new", cancel_at_period_end: false, status: "active" },
      ],
      orders: [
        order({ id: "other_buyer", user_id: "user_2", status: "paid", paid_at: "2026-12-01T00:00:00.000Z", teacher_stripe_connected_account_id: "acct_other_buyer" }),
        order({ id: "other_course", course_id: "course_2", status: "paid", paid_at: "2026-11-01T00:00:00.000Z", teacher_stripe_connected_account_id: "acct_other_course" }),
        order({ id: "in_new", status: "paid", amount_minor: 1000, paid_at: "2026-10-01T00:00:00.000Z", teacher_stripe_connected_account_id: newAccount }),
        order(),
      ],
      courses: [
        { id: "course_2", stripe_connected_account_id: "acct_other_course", owner_id: "teacher_2" },
        { id: "course_1", stripe_connected_account_id: newAccount, owner_id: "teacher_1" },
      ],
    };
    subscriptions = new Map();
    placeTarget(oldAccount);
    subscriptions.set(providerKey(newAccount, "sub_new"), {
      ...target(),
      id: "sub_new",
      metadata: { ...target().metadata },
    });
    mocks.requireUserId.mockResolvedValue("user_1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.getUserRow.mockImplementation(async (uid: string) => owners.get(uid) ?? null);
    mocks.getAdmin.mockReturnValue({
      from: (table: string) => {
        if (!Object.hasOwn(rows, table)) throw new Error("Unexpected table in cancellation test");
        return new Query(table as Table);
      },
    });
    mocks.retrieve.mockImplementation(async (id: string, _expand: unknown, options: AccountOptions) => {
      const key = providerKey(options?.stripeAccount, id);
      events.push(`stripe:retrieve:${key}`);
      const subscription = subscriptions.get(key);
      if (!subscription) throw new Error("No subscription in the selected test account");
      return { ...subscription, metadata: { ...subscription.metadata } };
    });
    mocks.update.mockImplementation(async (
      id: string,
      values: { cancel_at_period_end: boolean },
      options: AccountOptions,
    ) => {
      const key = providerKey(options?.stripeAccount, id);
      events.push(`stripe:update:${key}`);
      const subscription = subscriptions.get(key);
      if (!subscription) throw new Error("No subscription in the selected test account");
      Object.assign(subscription, values);
      return { ...subscription };
    });
    mocks.getStripe.mockReturnValue({
      subscriptions: { retrieve: mocks.retrieve, update: mocks.update },
    });
  });

  afterEach(() => {
    try {
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it.each(["refunded", "canceled"])(
    "prefers the exact %s ledger snapshot over another subscription's newer order and live account",
    async (status) => {
      rows.payout_ledger.find((row) => row.id === "ledger_old")!.status = status;
      const response = await POST(request());

      expect(response.status).toBe(200);
      expectProviderScope(oldAccount);
      expectFilters(reads("enrollments")[0], { id: "user_1__course_1" });
      const query = reads("payout_ledger")[0];
      expectFilters(query, {
        subscription_id: "sub_old", course_id: "course_1", kind: "course_subscription",
      });
      expect(query.filters.some((filter) => filter.column === "status")).toBe(false);
      expect(query.matchedIds).toEqual(["ledger_old"]);
      expect(reads("orders")).toEqual([]);
      expect(reads("courses")).toEqual([]);
      expect(mirrorWrites()[0].matchedIds).toEqual(["sub_old"]);
      expect(rows.course_subscriptions[0].cancel_at_period_end).toBe(true);
    },
  );

  it("selects one ledger invoice deterministically by created_at DESC then id ASC", async () => {
    rows.payout_ledger = [
      ledger({ id: "ledger_no_account", created_at: "2026-12-01T00:00:00.000Z", teacher_stripe_connected_account_id: null }),
      ledger({ id: "ledger_z", created_at: "2026-10-01T00:00:00.000Z", teacher_stripe_connected_account_id: "acct_wrong_tie" }),
      ledger({ id: "ledger_zz_older", created_at: "2026-09-01T00:00:00.000Z", teacher_stripe_connected_account_id: "acct_wrong_older" }),
      ledger({ id: "ledger_a", created_at: "2026-10-01T00:00:00.000Z" }),
    ];
    const response = await POST(request());

    expect(response.status).toBe(200);
    expectProviderScope(oldAccount);
    const query = reads("payout_ledger")[0];
    expect(query.ordering.map(({ column, ascending }) => ({ column, ascending }))).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: true },
    ]);
    expect(query.limit).toBe(1);
    expect(query.matchedIds).toEqual(["ledger_a"]);
  });

  it.each(["missing", "without-account"])(
    "uses the exact invoice, including zero/refunded, when the ledger is %s",
    async (ledgerState) => {
      rows.payout_ledger = ledgerState === "missing" ? [] : [
        ledger({ teacher_stripe_connected_account_id: null }),
      ];
      const response = await POST(request());

      expect(response.status).toBe(200);
      expectProviderScope(oldAccount);
      const mirror = reads("course_subscriptions")[0];
      expectFilters(mirror, { id: "sub_old", user_id: "user_1", course_id: "course_1" });
      expect(mirror.matchedIds).toEqual(["sub_old"]);
      const invoice = reads("orders")[0];
      expectFilters(invoice, { id: "in_old", user_id: "user_1", course_id: "course_1" });
      expect(invoice.matchedIds).toEqual(["in_old"]);
      expect(invoice.filters.some((filter) =>
        ["status", "amount_minor"].includes(filter.column))).toBe(false);
      expect(reads("courses")).toEqual([]);
    },
  );

  it.each(["id", "user_id", "course_id"])(
    "does not use a mirror row with a different %s",
    async (field) => {
      rows.payout_ledger = [];
      rows.course_subscriptions[0][field] = "unrelated";
      placeTarget(newAccount);
      const response = await POST(request());

      expect(response.status).toBe(200);
      expectProviderScope(newAccount);
      expect(reads("course_subscriptions")[0].matchedIds).toEqual([]);
      expectFilters(reads("course_subscriptions")[0], {
        id: "sub_old", user_id: "user_1", course_id: "course_1",
      });
      expect(reads("orders").some((query) =>
        query.filters.some((filter) => filter.column === "id" && filter.value === "in_old"))).toBe(false);
    },
  );

  it.each(["id", "user_id", "course_id"])(
    "does not use an exact invoice with a different %s",
    async (field) => {
      rows.payout_ledger = [];
      rows.orders.find((row) => row.id === "in_old")![field] = "unrelated";
      placeTarget(newAccount);
      const response = await POST(request());

      expect(response.status).toBe(200);
      expectProviderScope(newAccount);
      expectFilters(reads("orders")[0], {
        id: "in_old", user_id: "user_1", course_id: "course_1",
      });
      expect(reads("orders")[0].matchedIds).toEqual([]);
      expect(reads("orders").at(-1)?.matchedIds).toEqual(["in_new"]);
    },
  );

  it("keeps the latest paid buyer/course snapshot fallback when exact origins have no account", async () => {
    rows.payout_ledger = [];
    rows.orders.find((row) => row.id === "in_old")!.teacher_stripe_connected_account_id = null;
    rows.orders.push(
      order({ id: "older_paid", status: "paid", paid_at: "2026-02-01T00:00:00.000Z", teacher_stripe_connected_account_id: "acct_older" }),
      order({ id: "newest_refunded", paid_at: "2026-12-01T00:00:00.000Z", teacher_stripe_connected_account_id: "acct_refunded_other_invoice" }),
      order({ id: "paid_no_account", status: "paid", paid_at: "2026-12-02T00:00:00.000Z", teacher_stripe_connected_account_id: null }),
      order({ id: "paid_without_date", status: "paid", paid_at: null, teacher_stripe_connected_account_id: "acct_undated" }),
    );
    placeTarget(newAccount);
    const response = await POST(request());

    expect(response.status).toBe(200);
    expectProviderScope(newAccount);
    const fallback = reads("orders").at(-1)!;
    expectFilters(fallback, { user_id: "user_1", course_id: "course_1", status: "paid" });
    expect(fallback.filters).toContainEqual({
      operator: "not", column: "teacher_stripe_connected_account_id", value: null,
    });
    expect(fallback.ordering[0]).toMatchObject({ column: "paid_at", ascending: false, nullsFirst: false });
    expect(fallback.limit).toBe(1);
    expect(fallback.matchedIds).toEqual(["in_new"]);
    expect(reads("courses")).toEqual([]);
  });

  it.each(["course", "owner", "platform", "missing-course"] as const)(
    "keeps the legacy %s account fallback and validates Stripe before mutation",
    async (source) => {
      withoutExactOrigins();
      rows.orders = [];
      const course = rows.courses.find((row) => row.id === "course_1")!;
      if (source !== "course") course.stripe_connected_account_id = null;
      if (source === "platform") owners.clear();
      if (source === "missing-course") rows.courses = rows.courses.filter((row) => row.id !== "course_1");
      const account = source === "course" ? newAccount : source === "owner" ? ownerAccount : undefined;
      placeTarget(account);
      const response = await POST(request());

      expect(response.status).toBe(200);
      expectProviderScope(account);
      expectFilters(reads("courses")[0], { id: "course_1" });
      expect(reads("courses")[0].matchedIds).toEqual(source === "missing-course" ? [] : ["course_1"]);
      if (source === "owner" || source === "platform") {
        expect(mocks.getUserRow).toHaveBeenCalledWith("teacher_1");
      } else {
        expect(mocks.getUserRow).not.toHaveBeenCalled();
      }
    },
  );

  const failureStages = [
    "enrollment", "ledger", "mirror", "exact-invoice", "legacy-orders", "course",
  ] as const;

  for (const mode of ["returned", "rejected"] as const) {
    it.each(failureStages)(
      `fails closed on a ${mode} %s context error, without fallback or Stripe calls`,
      async (stage) => {
        if (["mirror", "exact-invoice", "legacy-orders", "course"].includes(stage)) {
          rows.payout_ledger = [];
        }
        if (stage === "legacy-orders" || stage === "course") withoutExactOrigins();
        if (stage === "course") rows.orders = [];
        const table: Table = stage === "enrollment" ? "enrollments"
          : stage === "ledger" ? "payout_ledger"
            : stage === "mirror" ? "course_subscriptions"
              : stage === "course" ? "courses" : "orders";
        readFailure = {
          mode,
          matches: (query) => query.table === table && (
            stage === "exact-invoice"
              ? query.filters.some((filter) => filter.column === "id" && filter.value === "in_old")
              : stage === "legacy-orders"
                ? !query.filters.some((filter) => filter.column === "id")
                : true
          ),
        };
        const response = await POST(request());

        await expectContextUnavailable(response);
        expect(queries.at(-1)?.table).toBe(table);
        expect(readFailure.matches(queries.at(-1)!)).toBe(true);
        expect(mocks.getUserRow).not.toHaveBeenCalled();
      },
    );
  }

  it.each(["throw", "reject"] as const)(
    "fails closed when the owner's account helper raises a %s",
    async (mode) => {
      withoutExactOrigins();
      rows.orders = [];
      rows.courses.find((row) => row.id === "course_1")!.stripe_connected_account_id = null;
      if (mode === "throw") {
        mocks.getUserRow.mockImplementation(() => { throw new Error(internalError.message); });
      } else {
        mocks.getUserRow.mockRejectedValue(new Error(internalError.message));
      }
      const response = await POST(request());

      await expectContextUnavailable(response);
      expect(mocks.getUserRow).toHaveBeenCalledWith("teacher_1");
    },
  );

  it.each([
    { label: "purpose", patch: { purpose: "creator_subscription" } },
    { label: "missing purpose", patch: { purpose: undefined } },
    { label: "buyer", patch: { userId: "user_2" } },
    { label: "missing buyer", patch: { userId: undefined } },
    { label: "course", patch: { courseId: "course_2" } },
    { label: "present-but-empty course", patch: { courseId: "" } },
  ])("denies divergent Stripe metadata: $label", async ({ patch }) => {
    Object.assign(target().metadata, patch);
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "permission_denied" });
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_old", undefined, { stripeAccount: oldAccount });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mirrorWrites()).toEqual([]);
    expect(target().cancel_at_period_end).toBe(false);
  });

  it.each(["sub_new", undefined])("denies a retrieved Stripe id that differs from the enrollment: %s", async (id) => {
    mocks.retrieve.mockResolvedValue({ ...target(), id });
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "permission_denied" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mirrorWrites()).toEqual([]);
  });

  it.each(["paid-order", "course", "owner", "platform"] as const)(
    "still validates Stripe ownership when using the legacy %s fallback",
    async (source) => {
      withoutExactOrigins();
      if (source !== "paid-order") rows.orders = [];
      if (source === "owner" || source === "platform") {
        rows.courses.find((row) => row.id === "course_1")!.stripe_connected_account_id = null;
      }
      if (source === "platform") owners.clear();
      const account = source === "owner" ? ownerAccount : source === "platform" ? undefined : newAccount;
      placeTarget(account).metadata.userId = "user_2";
      const response = await POST(request());

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "permission_denied" });
      expect(mocks.retrieve).toHaveBeenCalledWith(
        "sub_old", undefined, account ? { stripeAccount: account } : undefined,
      );
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mirrorWrites()).toEqual([]);
      expect(target(account).cancel_at_period_end).toBe(false);
    },
  );

  it.each([false, true])("allows undefined legacy courseId metadata (resume=%s)", async (resume) => {
    target().metadata.courseId = undefined;
    target().cancel_at_period_end = resume;
    const response = await POST(request({ courseId: "course_1", resume }));

    expect(response.status).toBe(200);
    expectProviderScope(oldAccount, !resume);
  });

  it.each([
    { label: "true", value: true, cancel: false },
    { label: "false", value: false, cancel: true },
    { label: "missing", value: undefined, cancel: true },
    { label: "string true", value: "true", cancel: true },
    { label: "string false", value: "false", cancel: true },
    { label: "one", value: 1, cancel: true },
    { label: "null", value: null, cancel: true },
    { label: "object", value: {}, cancel: true },
  ])("only boolean true resumes: $label", async ({ value, cancel }) => {
    target().cancel_at_period_end = !cancel;
    const response = await POST(request({ courseId: "course_1", resume: value }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cancelAtPeriodEnd: cancel,
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      status: "active",
    });
    expectProviderScope(oldAccount, cancel);
    expect(mirrorWrites()[0].matchedIds).toEqual(["sub_old"]);
    expect(mirrorWrites()[0].values).toMatchObject({ cancel_at_period_end: cancel });
    expect(events.indexOf("db:update:course_subscriptions")).toBeGreaterThan(
      events.indexOf(`stripe:update:${providerKey(oldAccount, "sub_old")}`),
    );
  });

  it.each([true, false])(
    "returns and mirrors Stripe's confirmed cancellation=%s instead of the requested value",
    async (confirmed) => {
      const resume = confirmed;
      target().cancel_at_period_end = !confirmed;
      rows.course_subscriptions[0].cancel_at_period_end = !confirmed;
      mocks.update.mockResolvedValue({ ...target(), cancel_at_period_end: confirmed });

      const response = await POST(request({ courseId: "course_1", resume }));

      expect(response.status).toBe(200);
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
        "sub_old", { cancel_at_period_end: !resume }, { stripeAccount: oldAccount },
      );
      expect(await response.json()).toEqual({
        cancelAtPeriodEnd: confirmed,
        currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
        status: "active",
      });
      expect(mirrorWrites()).toHaveLength(1);
      expect(mirrorWrites()[0].matchedIds).toEqual(["sub_old"]);
      expect(mirrorWrites()[0].values).toMatchObject({ cancel_at_period_end: confirmed });
      expect(rows.course_subscriptions[0].cancel_at_period_end).toBe(confirmed);
      expect(rows.course_subscriptions[1].cancel_at_period_end).toBe(false);
    },
  );

  it("duplicate cancel requests and resume never switch to the other subscription/account", async () => {
    const responses = await Promise.all([
      POST(request({ courseId: "course_1", subscriptionId: "sub_new", userId: "user_2" })),
      POST(request({ courseId: "course_1", subscriptionId: "sub_new", userId: "user_2" })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(target().cancel_at_period_end).toBe(true);
    rows.courses.find((row) => row.id === "course_1")!.stripe_connected_account_id = "acct_reconnected_again";
    const response = await POST(request({ courseId: "course_1", resume: true }));

    expect(response.status).toBe(200);
    expectProviderScope(oldAccount, false);
    expect(mocks.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.update).toHaveBeenCalledTimes(3);
    for (const [id, , options] of mocks.update.mock.calls) {
      expect({ id, options }).toEqual({ id: "sub_old", options: { stripeAccount: oldAccount } });
    }
    expect(mirrorWrites().map((query) => query.matchedIds)).toEqual([
      ["sub_old"], ["sub_old"], ["sub_old"],
    ]);
  });

  it("rejects an unauthenticated request before any context or provider access", async () => {
    mocks.requireUserId.mockRejectedValue(new PaymentError("Sign in.", 401, "unauthenticated"));
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(queries).toEqual([]);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   ", "x".repeat(161)])(
    "rejects an absent or invalid courseId (%s)",
    async (courseId) => {
      const response = await POST(request({ courseId }));

      expect(response.status).toBe(400);
      expect(queries).toEqual([]);
      expect(mocks.retrieve).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("cannot manage another student's enrollment via body user/subscription overrides", async () => {
    rows.enrollments = rows.enrollments.filter((row) => row.id !== "user_1__course_1");
    const response = await POST(request({
      courseId: "course_1", userId: "user_2", subscriptionId: "sub_new",
    }));

    expect(response.status).toBe(400);
    expectFilters(reads("enrollments")[0], { id: "user_1__course_1" });
    expect(reads("enrollments")[0].matchedIds).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated learner before context reads", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new PaymentError("Try later.", 429));
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      "course_sub_cancel_user_1", 20, 60 * 60 * 1000,
    );
    expect(queries).toEqual([]);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["retrieve", "update"] as const)(
    "does not write the local mirror when Stripe %s fails",
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error("private-stripe-error"));
      const response = await POST(request());

      expect(response.status).toBeGreaterThanOrEqual(500);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("private-stripe-error");
      expect(mirrorWrites()).toEqual([]);
      expect(target().cancel_at_period_end).toBe(false);
      expect(rows.course_subscriptions[0].cancel_at_period_end).toBe(false);
      expect(mocks.retrieve).toHaveBeenCalledExactlyOnceWith(
        "sub_old", undefined, { stripeAccount: oldAccount },
      );
      if (operation === "retrieve") {
        expect(mocks.update).not.toHaveBeenCalled();
      } else {
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
          "sub_old", { cancel_at_period_end: true }, { stripeAccount: oldAccount },
        );
      }
      expect(reads("courses")).toEqual([]);
    },
  );

  it.each(["ledger", "exact-invoice"] as const)(
    "does not retry another account after resource_missing for the %s origin",
    async (source) => {
      if (source === "exact-invoice") rows.payout_ledger = [];
      mocks.retrieve.mockRejectedValue(Object.assign(new Error("private-stripe-error"), {
        statusCode: 404,
        code: "resource_missing",
      }));
      const response = await POST(request());

      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("private-stripe-error");
      expect(mocks.retrieve).toHaveBeenCalledExactlyOnceWith(
        "sub_old", undefined, { stripeAccount: oldAccount },
      );
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mirrorWrites()).toEqual([]);
      expect(reads("courses")).toEqual([]);
      expect(mocks.getUserRow).not.toHaveBeenCalled();
      expect(reads("orders")).toHaveLength(source === "ledger" ? 0 : 1);
      if (source === "exact-invoice") {
        expectFilters(reads("orders")[0], { id: "in_old", user_id: "user_1", course_id: "course_1" });
      }
    },
  );

  it.each(["returned", "rejected"] as const)(
    "reports the completed Stripe change when the later mirror write is %s",
    async (mode) => {
      mirrorWriteFailure = mode;
      const response = await POST(request());

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
      expect(body.code).not.toBe("subscription_context_unavailable");
      expect(body.error).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(internalError.message);
      expectProviderScope(oldAccount);
      expect(mirrorWrites()[0].matchedIds).toEqual(["sub_old"]);
      expect(rows.course_subscriptions[0].cancel_at_period_end).toBe(false);
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(
        "Course subscription updated in Stripe; local mirror sync deferred.",
      );
      expect(mocks.notifyOps).not.toHaveBeenCalled();
      expect(events.indexOf("db:update:course_subscriptions")).toBeGreaterThan(
        events.indexOf(`stripe:update:${providerKey(oldAccount, "sub_old")}`),
      );
    },
  );
});
