import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), rpc: vi.fn(), rateLimit: vi.fn(),
  getUserRow: vi.fn(), getStripe: vi.fn(), createLoginLink: vi.fn(),
  createAccount: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notify }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mocks.getUser }, rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({ url: "http://localhost", anonKey: "fixture" }),
}));
vi.mock("@/lib/supabase/rate-limit", () => ({ runRateLimit: mocks.rateLimit }));
vi.mock("@/lib/payments/server/stripe-helpers", () => ({ getUserRow: mocks.getUserRow }));
vi.mock("@/lib/payments/server/stripe", async (original) => ({
  ...await original<object>(), getStripeClient: mocks.getStripe,
}));

import { POST } from "./route";

// Auth, MFA, conta ativa e limite reais; so as fronteiras externas sao simuladas.
const handler: (request: Request) => Promise<Response> = POST;
const teacher = { roles: ["teacher"], stripe_connected_account_id: "acct_own" };
const loginUrl = "https://connect.stripe.com/express/acct_own/fixture";
function request(body: unknown = {}) {
  return new Request("https://example.test/api/payments/connect/login-link?accountId=acct_other", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
// Quem decide e o banco: session_is_strong (ja inclui conta ativa) e, quando a
// sessao e fraca, account_session_allowed separa "deve o codigo" de "bloqueada".
function sessionGate(strong: boolean, allowed: boolean) {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "session_is_strong" ? strong : name === "account_session_allowed" ? allowed : null,
    error: null,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "teacher-1", factors: [] } }, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.rateLimit.mockResolvedValue({ error: null });
  mocks.getUserRow.mockResolvedValue(teacher);
  mocks.createLoginLink.mockResolvedValue({ url: loginUrl });
  mocks.getStripe.mockReturnValue({ accounts: { createLoginLink: mocks.createLoginLink, create: mocks.createAccount } });
});
afterEach(() => vi.restoreAllMocks());

describe("POST connect/login-link", () => {
  it("uses only the session owner's account, ignores client destinations and never caches the link", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handler(request({ accountId: "acct_other", url: "https://evil.test" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ url: loginUrl });
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
    expect(mocks.getUserRow).toHaveBeenCalledWith("teacher-1");
    expect(mocks.rateLimit).toHaveBeenCalledWith("connect_login_teacher-1", 10, 3600000);
    expect(mocks.createLoginLink).toHaveBeenCalledExactlyOnceWith("acct_own");
    expect(mocks.createAccount).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each(["visitor", "invalid-session", "suspended", "mfa-pending", "status-unavailable"])("refuses %s before profile or Stripe access", async (state) => {
    if (state === "visitor") mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (state === "invalid-session") mocks.getUser.mockResolvedValue({ data: { user: { id: "teacher-1" } }, error: { message: "invalid" } });
    if (state === "suspended") mocks.rpc.mockResolvedValue({ data: false, error: null });
    if (state === "status-unavailable") mocks.rpc.mockResolvedValue({ data: null, error: { message: "private detail" } });
    if (state === "mfa-pending") sessionGate(false, true);
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getUserRow).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("allows an active teacher after completing the required second factor", async () => {
    sessionGate(true, true);
    expect((await handler(request())).status).toBe(200);
    expect(mocks.createLoginLink).toHaveBeenCalledExactlyOnceWith("acct_own");
  });

  it.each([null, { ...teacher, roles: ["student"] }, { ...teacher, roles: ["admin"] }])("refuses a missing profile or a non-teacher %#", async (profile) => {
    mocks.getUserRow.mockResolvedValue(profile);
    const response = await handler(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("offers setup without creating an account when none is stored", async () => {
    mocks.getUserRow.mockResolvedValue({ ...teacher, stripe_connected_account_id: null });
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "connect_required" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it.each([
    ["RATE_LIMIT exceeded", 429], ["backend unavailable", 502],
  ])("fails closed on throttle failure: %s", async (message, status) => {
    mocks.rateLimit.mockResolvedValue({ error: { message } });
    const response = await handler(request());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getUserRow).not.toHaveBeenCalled();
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it.each(["not-express", "orphan", "Stripe-unavailable"])("returns a safe recovery error for %s without logging or replacing the account", async (failure) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = `private Stripe diagnostic ${loginUrl}`;
    mocks.createLoginLink.mockRejectedValue(failure === "Stripe-unavailable"
      ? new Error(message)
      : new Stripe.errors.StripeInvalidRequestError({
        message, type: "invalid_request_error",
        code: failure === "orphan" ? "account_invalid" : "invalid_request",
      }));
    const response = await handler(request());
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: "We could not open Stripe. Try again or contact support.", code: "stripe_dashboard_unavailable",
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(mocks.createLoginLink).toHaveBeenCalledTimes(1);
    expect(mocks.createAccount).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({
      event: "payments.dashboard.unavailable",
      severity: "warn",
      summary: expect.any(String),
      context: { status: 502 },
    });
    expect(JSON.stringify(mocks.notify.mock.calls)).not.toContain(message);
    expect(JSON.stringify(mocks.notify.mock.calls)).not.toContain("acct_own");
  });
});
