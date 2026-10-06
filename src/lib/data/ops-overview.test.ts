import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readOverviewActivations,
  readOverviewCourses,
  readOverviewEnrollments,
  readOverviewOrders,
  readOverviewPublications,
  readOverviewUsers,
} from "./ops-overview";

type Call = [method: string, ...args: unknown[]];
const state = vi.hoisted(() => ({
  queries: [] as Call[][],
  pages: [] as Array<{ data: unknown[] | null; error: unknown }>,
}));

// Records the chain; `range` ends it and answers with the next queued page.
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    from(table: string) {
      const calls: Call[] = [["from", table]];
      state.queries.push(calls);
      const builder: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ["select", "eq", "gte", "order"]) {
        builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
      }
      builder.range = (...args: unknown[]) => {
        calls.push(["range", ...args]);
        return Promise.resolve(state.pages.shift() ?? { data: [], error: null });
      };
      return builder;
    },
  }),
}));

const SINCE = "2026-09-22T00:00:00.000Z";

beforeEach(() => {
  state.queries = [];
  state.pages = [];
});

describe("Overview reads", () => {
  it("pages past the 1000-row API cap instead of silently undercounting", async () => {
    const full = Array.from({ length: 1000 }, (_, index) => ({ created_at: SINCE, roles: [], uid: `u${index}` }));
    state.pages = [{ data: full, error: null }, { data: [{ created_at: SINCE, roles: [], uid: "last" }], error: null }];
    const rows = await readOverviewUsers(SINCE);
    expect(rows).toHaveLength(1001);
    expect(state.queries.map((calls) => calls.find(([method]) => method === "range"))).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
  });

  it("fails the read on any page error so a partial total is never shown", async () => {
    state.pages = [
      { data: Array.from({ length: 1000 }, () => ({})), error: null },
      { data: null, error: { message: "permission denied" } },
    ];
    await expect(readOverviewOrders(SINCE)).rejects.toThrow("permission denied");
  });

  it.each([
    ["users", () => readOverviewUsers(SINCE), [["gte", "created_at", SINCE]]],
    ["enrollments", () => readOverviewEnrollments(SINCE), [["gte", "created_at", SINCE]]],
    // updated_at >= paid_at, so this one filter covers sales, refunds and failures.
    ["orders", () => readOverviewOrders(SINCE), [["gte", "updated_at", SINCE]]],
    ["audit_log", () => readOverviewPublications(SINCE), [["eq", "action", "COURSE_PUBLISHED_BY_CREATOR"], ["gte", "created_at", SINCE]]],
    ["audit_log", () => readOverviewActivations(SINCE), [["eq", "action", "STOREFRONT_ACTIVATION_FEE_PAID"], ["gte", "created_at", SINCE]]],
    ["courses", () => readOverviewCourses(), []],
  ] as const)("reads %s with the browser session and only the window filters", async (table, read, filters) => {
    await read();
    const [calls] = state.queries;
    expect(calls[0]).toEqual(["from", table]);
    expect(calls.filter(([method]) => method === "eq" || method === "gte")).toEqual(filters);
    // Narrow column lists: no select("*") on users/orders.
    expect(calls.find(([method]) => method === "select")?.[1]).not.toBe("*");
  });
});
