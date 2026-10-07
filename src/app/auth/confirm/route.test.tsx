import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
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
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.createServer.mockResolvedValue({
      auth: {
        verifyOtp: mocks.verifyOtp,
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        getUser: mocks.getUser,
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

  // Secure email change mails the current AND the new address, each with its
  // own {{ .TokenHash }}; one link shape must carry both through verifyOtp.
  it("keeps the email change email on the cross-device token route", () => {
    const template = readFileSync("supabase/templates/email_change.html", "utf8");
    expect(template).toContain("/auth/confirm?token_hash={{ .TokenHash }}");
    expect(template).toContain("&amp;type=email_change");
    expect(template).toContain("&amp;next=/account%3Ftab%3Dsecurity");
    expect(template).not.toContain("{{ .ConfirmationURL }}");
  });

  it("verifies an email change token and returns to account security", async () => {
    const response = await get("?token_hash=abc&type=email_change&next=%2Faccount%3Ftab%3Dsecurity");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "email_change", token_hash: "abc" });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/account?tab=security`);
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
  });

  // The first of the two secure-change links succeeds without a session.
  it("forwards the first of two email change confirmations without a session", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const response = await get("?token_hash=abc&type=email_change&next=%2Faccount%3Ftab%3Dsecurity");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/account?tab=security`);
  });

  it("sends a failed email change token to login with the reason", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "bad token" } });
    const response = await get("?token_hash=abc&type=email_change&next=%2Faccount%3Ftab%3Dsecurity");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=confirm&returnTo=%2Faccount%3Ftab%3Dsecurity`);
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

  it.each(["signup", "email"])("preserves a platform invitation for a %s email opened on another device", async type => {
    const next = "/invitations/81000000-0000-4000-8000-000000000001";
    const redirect = `${ORIGIN}/auth/confirm?next=${encodeURIComponent(next)}`;
    const response = await get(`?token_hash=abc&type=${type}&redirect_to=${encodeURIComponent(redirect)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${next}`);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type, token_hash: "abc" });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
  });

  it.each(["https://evil.test/loading?next=route", `${ORIGIN}/auth/confirm?next=${encodeURIComponent("//evil.test")}`, `${ORIGIN}/auth/confirm?next=${encodeURIComponent("/\\evil.test")}`])("refuses an unsafe email redirect %s", async (redirectTo) => {
    const response = await get(`?token_hash=abc&type=signup&redirect_to=${encodeURIComponent(redirectTo)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/welcome`);
  });

  // Onda F: o link de confirmacao vencido ou ja usado nao pode ser beco.
  describe("expired or used signup confirmation", () => {
    const course = "/welcome?path=student&returnTo=%2Fcourses%2Ffocus";
    const signupLink = `?token_hash=abc&type=signup&redirect_to=${encodeURIComponent(`${ORIGIN}/auth/confirm?next=${encodeURIComponent(course)}`)}`;
    const confirmed = { data: { user: { id: "u-1", email_confirmed_at: "2026-10-07T00:00:00Z" } }, error: null };

    beforeEach(() => {
      mocks.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    });

    it.each([
      ["nobody is signed in", { data: { user: null }, error: null }],
      ["the session is not confirmed", { data: { user: { id: "u-1", email_confirmed_at: null } }, error: null }],
    ])("opens the resend screen, keeping the course, when %s", async (_label, session) => {
      mocks.getUser.mockResolvedValue(session);
      const response = await get(signupLink);
      expect(response.headers.get("location")).toBe(
        `${ORIGIN}/login?error=confirm_expired&path=student&returnTo=%2Fcourses%2Ffocus`,
      );
      expect(response.cookies.get(PASSWORD_RECOVERY_COOKIE)).toBeUndefined();
    });

    it("sends the expired reminder link (type email, no destination) to the resend screen", async () => {
      const response = await get("?token_hash=abc&type=email");
      expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=confirm_expired`);
    });

    it("sends someone already confirmed and signed in straight to the course", async () => {
      mocks.getUser.mockResolvedValue(confirmed);
      const response = await get(signupLink);
      expect(response.headers.get("location")).toBe(
        `${ORIGIN}/loading?next=welcome&path=student&returnTo=%2Fcourses%2Ffocus`,
      );
    });

    it("sends someone already confirmed and signed in home when the link had no course", async () => {
      mocks.getUser.mockResolvedValue(confirmed);
      const response = await get("?token_hash=abc&type=email");
      expect(response.headers.get("location")).toBe(`${ORIGIN}/loading?next=welcome`);
    });

    it.each(["https://evil.test/x", "//evil.test", "/\\evil.test"])("never turns %s into a destination for a signed-in person", async (target) => {
      mocks.getUser.mockResolvedValue(confirmed);
      const next = `/welcome?returnTo=${encodeURIComponent(target)}`;
      const response = await get(`?token_hash=abc&type=signup&redirect_to=${encodeURIComponent(`${ORIGIN}/auth/confirm?next=${encodeURIComponent(next)}`)}`);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/loading?next=welcome`);
    });

    // Troca de senha e troca de e-mail tem tela propria: nada de "entrar direto".
    it.each([
      ["recovery", "?token_hash=abc&type=recovery&next=/reset-password", `${ORIGIN}/login?error=confirm`],
      ["email change", "?token_hash=abc&type=email_change&next=%2Faccount%3Ftab%3Dsecurity", `${ORIGIN}/login?error=confirm&returnTo=%2Faccount%3Ftab%3Dsecurity`],
    ])("leaves a failed %s link as it was", async (_label, query, location) => {
      mocks.getUser.mockResolvedValue(confirmed);
      const response = await get(query);
      expect(response.headers.get("location")).toBe(location);
      expect(mocks.getUser).not.toHaveBeenCalled();
    });
  });

  // O lembrete de 24 h leva o curso no link (next); a confirmacao respeita.
  it("lands the reminder link on the course it carries", async () => {
    const next = "/welcome?path=student&returnTo=%2Fcourses%2Ffocus";
    const response = await get(`?token_hash=abc&type=email&next=${encodeURIComponent(next)}`);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
    expect(response.headers.get("location")).toBe(`${ORIGIN}${next}`);
  });
});
