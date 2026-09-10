// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), rpc: vi.fn(),
  admin: vi.fn(), send: vi.fn(), rate: vi.fn(), notify: vi.fn(), finishWaiver: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/rate-limit", () => ({ runRateLimit: mocks.rate }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notify }));
vi.mock("@/lib/payments/server/app-url", () => ({ getAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/payments/server/activation-waiver", () => ({ finishActivationWaiver: mocks.finishWaiver }));

import type { PlatformInvite } from "@/domain/platform-invites";
import { GET, POST } from "./route";

const origin = "https://app.example.test";
const url = `${origin}/api/operations/invitations`;
const uid = "11111111-1111-4111-8111-111111111111";
const inviteId = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-09-10T12:00:00Z");
const invite: PlatformInvite = {
  id: inviteId, email: "stored@example.test", access_level: "teacher",
  waive_activation: true, created_at: "2026-09-10T11:00:00Z",
  expires_at: "2026-09-17T11:00:00Z", accepted_at: null, revoked_at: null,
};
const create = { action: "create", email: " Submitted@Example.test ", accessLevel: "teacher", waiveActivation: true };
const actions = [
  create,
  { action: "resend", inviteId },
  { action: "revoke", inviteId },
  { action: "waive", uid, waived: true },
];

function request(body: unknown, requestOrigin = origin) {
  return new Request(url, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function inviteCalls() {
  return mocks.rpc.mock.calls.filter(([name]) => name !== "is_admin");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in invitation test"); }));
  // Exercise the real requireAdminUserId and enforceRateLimit helpers.
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: uid } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => {
    switch (name) {
      case "is_admin": return { data: true, error: null };
      case "admin_list_platform_invites": return { data: [invite], error: null };
      case "admin_create_platform_invite": return { data: invite, error: null };
      case "admin_revoke_platform_invite": return { data: null, error: null };
      case "admin_set_activation_waiver": return { data: { revision: inviteId }, error: null };
      default: throw new Error(`Unexpected scoped RPC: ${name}`);
    }
  });
  mocks.rate.mockResolvedValue({ data: null, error: null });
  mocks.admin.mockReturnValue({ auth: { signInWithOtp: mocks.send } });
  mocks.send.mockResolvedValue({ data: { user: null, session: null }, error: null });
  mocks.finishWaiver.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("operations invitation authorization", () => {
  it("does not report a waiver as complete before Stripe cleanup finishes", async () => {
    mocks.finishWaiver.mockRejectedValue(new Error("private provider detail"));
    const response = await POST(request({ action: "waive", uid, waived: true }));
    expect(response.status).toBe(500);
    expect(mocks.finishWaiver).toHaveBeenCalledWith(uid, inviteId);
    expect(await response.json()).toEqual({ error: "Could not update access. Please try again." });
  });

  it("does not run Stripe cleanup when revoking a waiver", async () => {
    expect((await POST(request({ action: "waive", uid, waived: false }))).status).toBe(200);
    expect(mocks.finishWaiver).not.toHaveBeenCalled();
  });

  it.each(["anonymous", "mfa_required", "user-with-error"])("denies %s on every action before RPC or email", async (state) => {
    mocks.getUser.mockResolvedValue({
      data: { user: state === "user-with-error" ? { id: uid } : null },
      error: state === "anonymous" ? null : { code: "mfa_required", message: "private auth diagnostic" },
    });
    for (const response of [await GET(), ...await Promise.all(actions.map((body) => POST(request(body))))]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "You must be signed in." });
    }
    expect(mocks.getUser).toHaveBeenCalledTimes(5);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([false, null, "rpc-error"])("denies an unavailable admin verdict (%s) on every action", async (verdict) => {
    mocks.rpc.mockResolvedValue({
      data: verdict === "rpc-error" ? true : verdict,
      error: verdict === "rpc-error" ? { message: "private role diagnostic" } : null,
    });
    const responses: Response[] = [await GET()];
    for (const body of actions) responses.push(await POST(request(body)));
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Admin privileges are required." });
    }
    expect(mocks.rpc.mock.calls).toEqual(Array.from({ length: 5 }, () => ["is_admin"]));
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(actions)("rejects a foreign origin before $action authorization", async (body) => {
    expect((await POST(request(body, "https://foreign.example.test"))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

describe("operations invitation input boundary", () => {
  it.each(actions)("rejects additional $action fields before mutations or transport", async (body) => {
    const response = await POST(request({ ...body, recipient: "forged@example.test" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request fields." });
    expect(inviteCalls()).toEqual([]);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    {}, { action: "toString" }, { action: "__proto__" }, { action: "delete" },
    { ...create, email: "invalid" }, { ...create, email: "a".repeat(250) + "@example.test" },
    { ...create, accessLevel: "owner" }, { ...create, waiveActivation: "true" },
    { ...create, accessLevel: "admin" },
    { action: "resend", inviteId: "not-a-uuid" },
    { action: "resend", inviteId, email: "forged@example.test" },
    { action: "revoke", inviteId: null },
    { action: "waive", uid: "not-a-uuid", waived: true },
    { action: "waive", uid, waived: "false" },
  ])("rejects invalid action data: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(inviteCalls()).toEqual([]);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["{", "null", "[]", '"text"', "true", "42", ""])("rejects malformed/non-object JSON (%s)", async (body) => {
    const response = await POST(new Request(url, { method: "POST", body }));
    expect(response.status).toBe(400);
    expect(inviteCalls()).toEqual([]);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("limits a streamed body without Content-Length before acting", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(JSON.stringify({ ...create, email: "a".repeat(2100) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes.slice(0, 1024)); controller.enqueue(bytes.slice(1024)); },
      cancel,
    });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
    const input = new Request(url, init);
    expect(input.headers.has("Content-Length")).toBe(false);
    const response = await POST(input);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request is too large." });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(inviteCalls()).toEqual([]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

describe("operations invitation scoped RPCs and delivery", () => {
  it("lists through the authenticated admin RPC with no-store", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ invites: [invite] });
    expect(mocks.rpc.mock.calls).toEqual([["is_admin"], ["admin_list_platform_invites"]]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("creates with normalized input but sends only to the authoritative DB recipient", async () => {
    const response = await POST(request(create));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invite, emailStatus: "sent" });
    expect(inviteCalls()).toEqual([["admin_create_platform_invite", {
      p_email: "submitted@example.test", p_access_level: "teacher", p_waive_activation: true,
    }]]);
    expect(mocks.rate.mock.calls).toEqual([
      [`platform_access_${uid}`, 30, 3600000], [`platform_invite_email_${inviteId}`, 3, 3600000],
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith({
      email: invite.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(`/invitations/${inviteId}`)}`,
      },
    });
  });

  it.each(["student", "staff", "admin"])("accepts %s access without an activation waiver", async (accessLevel) => {
    expect((await POST(request({ ...create, accessLevel, waiveActivation: false }))).status).toBe(200);
    expect(inviteCalls()).toEqual([["admin_create_platform_invite", {
      p_email: "submitted@example.test", p_access_level: accessLevel, p_waive_activation: false,
    }]]);
  });

  it("resends only the requested authorized row without creating another invitation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({
      data: [{ ...invite, id: uid, email: "different@example.test" }, invite], error: null,
    });
    const response = await POST(request({ action: "resend", inviteId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invite, emailStatus: "sent" });
    expect(inviteCalls()).toEqual([["admin_list_platform_invites"]]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].email).toBe(invite.email);
    expect(mocks.rate).toHaveBeenLastCalledWith(`platform_invite_email_${inviteId}`, 3, 3600000);
  });

  it.each([
    ["missing", []],
    ["expired", [{ ...invite, expires_at: "2026-09-10T11:59:59Z" }]],
    ["invalid expiry", [{ ...invite, expires_at: "not-a-date" }]],
    ["expires now", [{ ...invite, expires_at: new Date(now).toISOString() }]],
    ["revoked", [{ ...invite, revoked_at: "2026-09-10T11:30:00Z" }]],
    ["accepted", [{ ...invite, accepted_at: "2026-09-10T11:30:00Z" }]],
  ])("does not resend a %s invitation", async (_label, rows) => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: rows, error: null });
    const response = await POST(request({ action: "resend", inviteId }));
    expect(response.status).toBe(409);
    expect(inviteCalls()).toEqual([["admin_list_platform_invites"]]);
    expect(mocks.rate).toHaveBeenCalledTimes(1);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "revoke", inviteId }, "admin_revoke_platform_invite", { p_invite_id: inviteId }],
    [{ action: "waive", uid, waived: true }, "admin_set_activation_waiver", { p_target_uid: uid, p_waived: true }],
    [{ action: "waive", uid, waived: false }, "admin_set_activation_waiver", { p_target_uid: uid, p_waived: false }],
  ])("writes %j only through the scoped RPC", async (body, name, args) => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(inviteCalls()).toEqual([[name, args]]);
    expect(mocks.rate).toHaveBeenCalledTimes(1);
    expect(mocks.rate).toHaveBeenCalledWith(`platform_access_${uid}`, 30, 3600000);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["create", "resend", "revoke", "waive", "list"])("keeps DB errors opaque for %s", async (action) => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({
      data: null, error: { code: "XX000", message: "private database diagnostic", details: "private row", hint: "private schema" },
    });
    const response = action === "list" ? await GET() : await POST(request(actions.find((body) => body.action === action)));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not update access. Please try again." });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("honors a DB permission denial after the initial admin check", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({
      data: invite, error: { code: "42501", message: "private authorization diagnostic" },
    });
    const response = await POST(request(create));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "This action requires the appropriate account permissions and verification." });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["throttled", "unavailable", "throws"])("fails closed before mutation when the action limiter is %s", async (state) => {
    if (state === "throws") mocks.rate.mockRejectedValue(new Error("private rate diagnostic"));
    else mocks.rate.mockResolvedValue({ error: { message: state === "throttled" ? "RATE_LIMIT" : "private rate diagnostic" } });
    for (const body of actions) {
      const response = await POST(request(body));
      expect(response.status).toBe(state === "throttled" ? 429 : 500);
      expect(await response.json()).toEqual({ error: state === "throttled"
        ? "Too many attempts. Please wait before trying again." : "Could not update access. Please try again." });
    }
    expect(inviteCalls()).toEqual([]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["returned-error", "throws", "client-throws", "email-throttled", "email-limiter-unavailable"])("preserves the pending invitation when delivery fails: %s", async (state) => {
    if (state === "returned-error") mocks.send.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "private SMTP diagnostic" } });
    if (state === "throws") mocks.send.mockRejectedValueOnce(new Error("private SMTP diagnostic"));
    if (state === "client-throws") mocks.admin.mockImplementationOnce(() => { throw new Error("private provider diagnostic"); });
    if (state.startsWith("email-")) mocks.rate.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({
      error: { message: state === "email-throttled" ? "RATE_LIMIT" : "private rate diagnostic" },
    });
    const response = await POST(request(create));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invite, emailStatus: "failed" });
    expect(inviteCalls()).toHaveLength(1);
    expect(inviteCalls()[0][0]).toBe("admin_create_platform_invite");
    if (state.startsWith("email-") || state === "client-throws") expect(mocks.send).not.toHaveBeenCalled();

    mocks.send.mockClear();
    const resent = await POST(request({ action: "resend", inviteId }));
    expect(resent.status).toBe(200);
    expect(await resent.json()).toEqual({ invite, emailStatus: "sent" });
    expect(inviteCalls().map(([name]) => name)).toEqual(["admin_create_platform_invite", "admin_list_platform_invites"]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].email).toBe(invite.email);
  });
});
