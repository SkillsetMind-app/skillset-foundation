import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import { GET } from "@/app/auth/confirm/route";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-cookie";

const ORIGIN = "https://skillsetmind.com";

function get(query: string) {
  return GET(new NextRequest(`${ORIGIN}/auth/confirm${query}`));
}

describe("/auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.createServer.mockResolvedValue({
      auth: {
        verifyOtp: mocks.verifyOtp,
        exchangeCodeForSession: mocks.exchangeCodeForSession,
      },
    });
  });

  // The whole point of routing recovery here: verifyOtp is stateless, so the
  // link works in a browser that never held a PKCE code_verifier.
  it("verifies a recovery token and stamps recovery provenance", async () => {
    const response = await get(
      "?token_hash=abc&type=recovery&next=/reset-password",
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "abc",
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/reset-password`);
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value).toBe("1");
  });

  // A signup confirmation must never mint a pass into the reset form.
  it("withholds the recovery cookie for non-recovery types", async () => {
    const response = await get(
      "?token_hash=abc&type=signup&next=/reset-password",
    );

    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
  });

  it("keeps handling PKCE codes for links minted before the switch", async () => {
    const response = await get("?code=xyz&next=/reset-password");

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value).toBe("1");
  });

  // Regression: every failure used to collapse into one opaque message, which
  // is what made this class of bug undiagnosable from the UI.
  it("forwards Supabase's own reason for a consumed token", async () => {
    const response = await get(
      "?error=access_denied&error_code=otp_expired&next=/reset-password",
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login?error=otp_expired`,
    );
  });

  it("falls back to a generic reason when verification fails", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "bad token" } });

    const response = await get("?token_hash=abc&type=recovery");

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=confirm`);
  });

  it.each([["confirmation", "signup"], ["magic_link", "email"]])("keeps the %s email on the cross-device token route", (file, type) => {
    const template = readFileSync(`supabase/templates/${file}.html`, "utf8");
    expect(template).toContain("/auth/confirm?token_hash={{ .TokenHash }}");
    expect(template).toContain(`&amp;type=${type}`);
    expect(template).toContain("&amp;redirect_to={{ .RedirectTo | urlquery }}");
    expect(template).not.toContain("{{ .ConfirmationURL }}");
  });

  it("preserves the signup course and offer from the email on a fresh device", async () => {
    const next = "/welcome?returnTo=%2Fcourses%2Fcourse-1%3Foffer%3Doffer-1";
    const redirectTo = `${ORIGIN}/auth/confirm?next=${encodeURIComponent(next)}`;
    const response = await get(`?token_hash=abc&type=signup&redirect_to=${encodeURIComponent(redirectTo)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${next}`);
  });

  it("sends a manual OTP invitation to normal post-auth routing", async () => {
    const response = await get(`?token_hash=abc&type=email&redirect_to=${encodeURIComponent(`${ORIGIN}/loading?next=route`)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/loading?next=route`);
  });

  it.each(["https://evil.test/loading?next=route", `${ORIGIN}/auth/confirm?next=${encodeURIComponent("//evil.test")}`, `${ORIGIN}/auth/confirm?next=${encodeURIComponent("/\\evil.test")}`])("refuses an unsafe email redirect %s", async (redirectTo) => {
    const response = await get(`?token_hash=abc&type=signup&redirect_to=${encodeURIComponent(redirectTo)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/welcome`);
  });
});
