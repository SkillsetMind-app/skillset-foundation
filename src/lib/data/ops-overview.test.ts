import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readOverviewActivations,
  readOverviewAdminSession,
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
  rpc: [] as Call[],
  rpcResult: { data: true as unknown, error: null as unknown },
}));

// Records the chain; awaiting it answers with the next queued page.
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    from(table: string) {
      const calls: Call[] = [["from", table]];
      state.queries.push(calls);
      const builder: Record<string, unknown> = {
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(state.pages.shift() ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      for (const method of ["select", "eq", "gte", "order", "range", "abortSignal"]) {
        builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
      }
      return builder;
    },
    rpc(name: string) {
      state.rpc.push(["rpc", name]);
      const call = {
        abortSignal: (signal: AbortSignal) => { state.rpc.push(["abortSignal", signal]); return call; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(state.rpcResult).then(resolve),
      };
      return call;
    },
  }),
}));

const SINCE = "2026-09-22T00:00:00.000Z";
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ created_at: SINCE, roles: [], uid: `u${index}` }));
const ranges = () => state.queries.map((calls) => calls.find(([method]) => method === "range"));

beforeEach(() => {
  state.queries = [];
  state.pages = [];
  state.rpc = [];
  state.rpcResult = { data: true, error: null };
});

describe("Overview reads", () => {
  it("keeps paging until an empty page, past the 1000-row API cap", async () => {
    state.pages = [{ data: rows(1000), error: null }, { data: rows(1), error: null }, { data: [], error: null }];
    expect(await readOverviewUsers(SINCE)).toHaveLength(1001);
    expect(ranges()).toEqual([["range", 0, 999], ["range", 1000, 1999], ["range", 1001, 2000]]);
  });

  it("does not stop early when the server caps pages below 1000 rows", async () => {
    state.pages = [{ data: rows(500), error: null }, { data: rows(500), error: null }, { data: rows(3), error: null }, { data: [], error: null }];
    expect(await readOverviewUsers(SINCE)).toHaveLength(1003);
    expect(ranges()).toEqual([["range", 0, 999], ["range", 500, 1499], ["range", 1000, 1999], ["range", 1003, 2002]]);
  });

  it("fails the read on any page error so a partial total is never shown", async () => {
    state.pages = [
      { data: rows(1000), error: null },
      { data: null, error: { message: "permission denied" } },
    ];
    await expect(readOverviewOrders(SINCE)).rejects.toThrow("permission denied");
  });

  it("passes the abort signal to every page so a timeout or unmount cancels the request", async () => {
    const controller = new AbortController();
    state.pages = [{ data: rows(1), error: null }, { data: [], error: null }];
    await readOverviewUsers(SINCE, controller.signal);
    for (const calls of state.queries) {
      expect(calls).toContainEqual(["abortSignal", controller.signal]);
    }
  });

  it.each([
    ["users", () => readOverviewUsers(SINCE), [["gte", "created_at", SINCE]]],
    ["enrollments", () => readOverviewEnrollments(SINCE), [["gte", "created_at", SINCE]]],
    // updated_at >= paid_at, so this one filter covers sales and refunds.
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

describe("admin session check", () => {
  it("asks the database itself, through the existing is_admin()", async () => {
    const controller = new AbortController();
    expect(await readOverviewAdminSession(controller.signal)).toBe(true);
    expect(state.rpc).toEqual([["rpc", "is_admin"], ["abortSignal", controller.signal]]);
  });

  it("is false for a session without the second factor (is_admin() answers false)", async () => {
    state.rpcResult = { data: false, error: null };
    expect(await readOverviewAdminSession()).toBe(false);
  });

  it("fails closed when the check itself fails", async () => {
    state.rpcResult = { data: null, error: { message: "network" } };
    await expect(readOverviewAdminSession()).rejects.toThrow("network");
  });
});
