// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), exchange: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { verifyOtp: mocks.verify, exchangeCodeForSession: mocks.exchange },
  })),
}));

import { GET as callback } from "@/app/auth/callback/route";
import { GET as confirm } from "@/app/auth/confirm/route";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-cookie";

const origin = "https://www.skillsetmind.com";
const target = "/courses/example?offer=annual#checkout";

describe.each([["callback", callback], ["confirm", confirm]] as const)("%s login error context", (route, handler) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ error: null });
    mocks.exchange.mockResolvedValue({ error: null });
  });

  async function request(next: string, fields: Record<string, string> = {}) {
    const params = new URLSearchParams({ next, ...fields });
    return handler(new NextRequest(`${origin}/auth/${route}?${params}`));
  }

  it("does not replace the normal workspace destination when next is absent", async () => {
    const response = await handler(new NextRequest(`${origin}/auth/${route}?error=access_denied`));
    expect(response.headers.get("location")).toBe(`${origin}/login?error=access_denied`);
  });

  it.each([
    ["/loading?next=welcome&path=teacher", "teacher"],
    ["/welcome?path=student", "student"],
    ["/loading?next=route&role=teacher", "teacher"],
  ])("keeps intent and course/offer after an expired link from %s", async (entry, intent) => {
    const next = `${entry}&returnTo=${encodeURIComponent(target)}`;
    const response = await request(next, { error: "access_denied", error_code: "otp_expired" });
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(origin);
    expect(location.pathname).toBe("/login");
    expect(Object.fromEntries(location.searchParams)).toEqual({ error: "otp_expired", path: intent, returnTo: target });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
  });

  it("keeps a direct course destination when the code exchange fails without forwarding the code", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "private provider diagnostic" } });
    const response = await request(target, { code: "one-time-fixture" });
    const location = new URL(response.headers.get("location")!);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      error: route === "callback" ? "auth_callback" : "confirm",
      returnTo: target,
    });
    expect(location.href).not.toContain("one-time-fixture");
    expect(location.href).not.toContain("private provider diagnostic");
  });

  it.each(["https://outside.test/learn", "//outside.test/learn", "/\\outside.test", "/\n/outside.test", "/\t/outside.test", "/\r/outside.test", "/auth?mode=signin", "/loading", "/welcome", "/reset-password"])("does not turn %j into a post-login destination", async (returnTo) => {
    const response = await request(`/loading?path=teacher&returnTo=${encodeURIComponent(returnTo)}`, { error: "access_denied" });
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(origin);
    expect(location.searchParams.get("returnTo")).toBeNull();
    expect(location.searchParams.get("path")).toBe("teacher");
  });

  it.each(["https://outside.test/loading?path=teacher", "//outside.test/loading?path=teacher", "/\\outside.test/loading?path=teacher", "/\n/outside.test/loading?path=teacher"])("discards an unsafe outer context %j", async (next) => {
    const response = await request(next, { error: "access_denied" });
    expect(response.headers.get("location")).toBe(`${origin}/login?error=access_denied`);
  });

  it.each(["/courses/../auth#signin", "/courses/../reset-password?step=1", "/reset-password/", "/reset-password//?step=1", "/courses/../reset-password/", "/learn/..//outside.test", "/auth#signin"])("rejects normalized auth loops and network paths: %s", async (returnTo) => {
    const response = await request(`/loading?path=student&returnTo=${encodeURIComponent(returnTo)}`, { error: "access_denied" });
    expect(new URL(response.headers.get("location")!).searchParams.get("returnTo")).toBeNull();
  });

  it("does not accept an arbitrary role or forward unrelated auth parameters", async () => {
    const response = await request(`/welcome?path=admin&code=nested-fixture&token_hash=nested-hash&returnTo=${encodeURIComponent(target)}`, { error: "access_denied" });
    const location = new URL(response.headers.get("location")!);
    expect(Object.fromEntries(location.searchParams)).toEqual({ error: "access_denied", returnTo: target });
  });

  it("keeps successful routing and recovery provenance unchanged", async () => {
    const next = `/loading?next=route&path=teacher&returnTo=${encodeURIComponent(target)}`;
    const response = await request(next, { code: "success-fixture" });
    expect(response.headers.get("location")).toBe(`${origin}${next}`);
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
    const recovery = await request("/reset-password", { code: "recovery-fixture" });
    expect(recovery.headers.get("location")).toBe(`${origin}/reset-password`);
    expect(recovery.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value).toBe("1");
  });
});

describe("email confirmation error context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ error: { message: "expired fixture" } });
  });

  it.each(["loading", "confirm"])("preserves intent from the same-origin %s email redirect after verifyOtp fails", async (entry) => {
    const next = `/loading?next=welcome&path=teacher&returnTo=${encodeURIComponent(target)}`;
    const redirect = entry === "loading" ? `${origin}${next}` : `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
    const params = new URLSearchParams({ token_hash: "email-fixture", type: "signup", redirect_to: redirect });
    const response = await confirm(new NextRequest(`${origin}/auth/confirm?${params}`));
    expect(Object.fromEntries(new URL(response.headers.get("location")!).searchParams)).toEqual({ error: "confirm", path: "teacher", returnTo: target });
    expect(mocks.verify).toHaveBeenCalledWith({ token_hash: "email-fixture", type: "signup" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
  });

  it.each(["https://outside.test/loading?path=teacher", "not-a-url"])("discards untrusted email redirect %s", async (redirect_to) => {
    const params = new URLSearchParams({ error: "otp_expired", redirect_to });
    const response = await confirm(new NextRequest(`${origin}/auth/confirm?${params}`));
    expect(response.headers.get("location")).toBe(`${origin}/login?error=otp_expired`);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
