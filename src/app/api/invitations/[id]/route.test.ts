// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), rate: vi.fn(), admin: vi.fn(), finishWaiver: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/rate-limit", () => ({ runRateLimit: mocks.rate }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: vi.fn() }));
vi.mock("@/lib/payments/server/activation-waiver", () => ({ finishActivationWaiver: mocks.finishWaiver }));

import { GET, POST } from "./route";

const origin = "https://app.example.test";
const id = "22222222-2222-4222-8222-222222222222";
const uid = "11111111-1111-4111-8111-111111111111";
const url = `${origin}/api/invitations/${id}`;
const invite = { id, email: "recipient@example.test", access_level: "student", accepted_at: null, revoked_at: null };
const accepted = { ...invite, accepted_at: "2026-09-10T12:00:00Z", roles: ["student"], next_path: "/learn" };
function context(inviteId = id) { return { params: Promise.resolve({ id: inviteId }) }; }
function request(method: "GET" | "POST", body?: string, requestOrigin = origin) {
  return new Request(url, { method, headers: { Origin: requestOrigin }, ...(body === undefined ? {} : { body }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in acceptance test"); }));
  // Real requireUserId consumes the already MFA-gated server client's verdict.
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: uid } }, error: null });
  mocks.rate.mockResolvedValue({ data: null, error: null });
  mocks.finishWaiver.mockResolvedValue(undefined);
  mocks.admin.mockImplementation(() => { throw new Error("Acceptance must not use a service-role client"); });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "get_my_platform_invite") return { data: invite, error: null };
    if (name === "accept_platform_invite") return { data: accepted, error: null };
    throw new Error(`Unexpected scoped RPC: ${name}`);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("authenticated invitation lookup and acceptance", () => {
  it("finishes only the authenticated recipient's DB-issued waiver revision", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...accepted, waive_activation: true, waiver_revision: id }, error: null });
    const response = await POST(request("POST", JSON.stringify({ uid: "forged", revision: "forged" })), context());
    expect(response.status).toBe(200);
    expect(mocks.finishWaiver).toHaveBeenCalledWith(uid, id);
  });

  it("keeps a partial waiver failure retryable without claiming completion", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...accepted, waive_activation: true, waiver_revision: id }, error: null });
    mocks.finishWaiver.mockRejectedValueOnce(new Error("private provider detail"));
    expect((await POST(request("POST"), context())).status).toBe(500);
    expect((await POST(request("POST"), context())).status).toBe(200);
    expect(mocks.finishWaiver).toHaveBeenNthCalledWith(2, uid, id);
  });

  it.each(["anonymous", "mfa_required", "user-with-error"])("denies %s before lookup or acceptance", async (state) => {
    mocks.getUser.mockResolvedValue({
      data: { user: state === "user-with-error" ? { id: uid } : null },
      error: state === "anonymous" ? null : { code: "mfa_required", message: "private auth diagnostic" },
    });
    for (const response of [await GET(request("GET"), context()), await POST(request("POST"), context())]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "You must be signed in." });
    }
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("rejects cross-origin acceptance before authentication", async () => {
    const response = await POST(request("POST", undefined, "https://foreign.example.test"), context());
    expect(response.status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["", "invalid", `${id}/extra`, ` ${id}`, `${id} `])("rejects an invalid URL id (%s) before RPC", async (invalidId) => {
    expect((await GET(request("GET"), context(invalidId))).status).toBe(400);
    expect((await POST(request("POST"), context(invalidId))).status).toBe(400);
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("looks up only the caller's invitation through the scoped RPC with no-store", async () => {
    const response = await GET(request("GET"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ invite });
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([["get_my_platform_invite", { p_invite_id: id }]]);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("accepts with only the URL id; identity and grants are the scoped RPC's responsibility", async () => {
    const response = await POST(request("POST"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(accepted);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([["accept_platform_invite", { p_invite_id: id }]]);
    expect(mocks.rate).toHaveBeenCalledTimes(1);
    expect(mocks.rate).toHaveBeenCalledWith(`platform_invite_accept_${uid}`, 20, 3600000);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("does not forward forged acceptance body fields or query parameters", async () => {
    const input = new Request(`${url}?uid=${uid}&email=forged@example.test&role=admin`, {
      method: "POST", body: JSON.stringify({
        inviteId: uid, uid: "other-user", email: "forged@example.test", roles: ["admin"],
        accessLevel: "admin", waiveActivation: true, next_path: "https://foreign.example.test",
      }),
    });
    const response = await POST(input, context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(accepted);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([["accept_platform_invite", { p_invite_id: id }]]);
    expect(mocks.rate).toHaveBeenCalledTimes(1);
    expect(mocks.rate).toHaveBeenCalledWith(`platform_invite_accept_${uid}`, 20, 3600000);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["wrong recipient", "unconfirmed email", "expired", "revoked", "already accepted"])("honors a scoped DB refusal for %s without privileged fallback", async (reason) => {
    // SQL smoke tests establish these rules; here we verify refusal propagation.
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: `private: ${reason}` } });
    for (const response of [await GET(request("GET"), context()), await POST(request("POST"), context())]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "This action requires the appropriate account permissions and verification." });
    }
    expect(mocks.rpc.mock.calls).toEqual([
      ["get_my_platform_invite", { p_invite_id: id }], ["accept_platform_invite", { p_invite_id: id }],
    ]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["returned-error", "throws"])("does not expose DB diagnostics (%s)", async (state) => {
    if (state === "throws") mocks.rpc.mockRejectedValue(new Error("private database diagnostic"));
    else mocks.rpc.mockResolvedValue({ data: accepted, error: { code: "XX000", message: "private database diagnostic", hint: "private schema" } });
    for (const response of [await GET(request("GET"), context()), await POST(request("POST"), context())]) {
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Could not update access. Please try again." });
    }
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["throttled", "unavailable", "throws"])("does not accept when rate limiting is %s", async (state) => {
    if (state === "throws") mocks.rate.mockRejectedValue(new Error("private rate diagnostic"));
    else mocks.rate.mockResolvedValue({ error: { message: state === "throttled" ? "RATE_LIMIT" : "private rate diagnostic" } });
    const response = await POST(request("POST"), context());
    expect(response.status).toBe(state === "throttled" ? 429 : 500);
    expect(await response.json()).toEqual({ error: state === "throttled"
      ? "Too many attempts. Please wait before trying again." : "Could not update access. Please try again." });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
