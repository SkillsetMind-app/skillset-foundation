import { describe, expect, it } from "vitest";

import { getAuthErrorMessage } from "@/lib/auth/supabase-auth";

describe("getAuthErrorMessage", () => {
  it("maps invalid credentials by message, case-insensitively", () => {
    expect(
      getAuthErrorMessage({ message: "Invalid Login Credentials" }),
    ).toBe(
      "Incorrect email or password. If you signed up recently, your account may not have been created — please sign up again.",
    );
  });

  it("maps invalid credentials by error code", () => {
    expect(getAuthErrorMessage({ code: "invalid_credentials" })).toContain(
      "Incorrect email or password",
    );
  });

  it("maps unconfirmed email", () => {
    expect(getAuthErrorMessage({ code: "email_not_confirmed" })).toBe(
      "Verify your email to finish signing in. Check your inbox for the link.",
    );
    expect(getAuthErrorMessage({ message: "Email not confirmed" })).toContain(
      "Verify your email",
    );
  });

  it("maps confirmation email send failures (message, code, and HTTP 500)", () => {
    const expected =
      "We could not send the confirmation email. Please try again in a few minutes or contact support.";
    expect(
      getAuthErrorMessage({ message: "Error sending confirmation email" }),
    ).toBe(expected);
    expect(getAuthErrorMessage({ code: "unexpected_failure" })).toBe(expected);
    expect(
      getAuthErrorMessage({ message: "Internal server error", status: 500 }),
    ).toBe(expected);
  });

  it("maps recovery email send failures to a reset-specific message", () => {
    expect(
      getAuthErrorMessage({ message: "Error sending recovery email" }),
    ).toBe(
      "We could not send the password reset email. Please try again in a few minutes or contact support.",
    );
  });

  it("maps rate limit codes, including underscore variants", () => {
    const expected = "Too many attempts. Wait a moment and try again.";
    expect(getAuthErrorMessage({ code: "over_request_rate_limit" })).toBe(
      expected,
    );
    expect(getAuthErrorMessage({ code: "over_email_send_rate_limit" })).toBe(
      expected,
    );
    expect(
      getAuthErrorMessage({ message: "Rate limit exceeded" }),
    ).toBe(expected);
  });

  it("passes through unmapped non-empty messages", () => {
    expect(getAuthErrorMessage({ message: "Custom auth failure." })).toBe(
      "Custom auth failure.",
    );
  });

  it("never returns an empty string", () => {
    const fallback = "Something went wrong. Please try again.";
    const inputs: unknown[] = [
      {},
      null,
      undefined,
      "a plain string",
      42,
      { message: "" },
      { message: "   " },
      { message: undefined },
      { message: { nested: true } },
      { code: undefined, message: null },
    ];

    for (const input of inputs) {
      const result = getAuthErrorMessage(input);
      expect(result).toBe(fallback);
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
