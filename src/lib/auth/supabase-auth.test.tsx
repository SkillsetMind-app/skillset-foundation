import { describe, expect, it, vi } from "vitest";

import {
  getAuthErrorMessage,
  getSignupLegalVersions,
  refreshCurrentUserEmailVerification,
  signUpWithEmail,
} from "@/lib/auth/supabase-auth";
import { currentPrivacyVersion, currentTermsVersion } from "@/lib/legal/versions";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  getUser: vi.fn(),
  firstTouch: null as Record<string, string> | null,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({ auth: { signUp: mocks.signUp, getUser: mocks.getUser } }),
}));
vi.mock("@/lib/auth/pwned-password", () => ({ assertPasswordNotBreached: vi.fn() }));
vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/attribution/first-touch", () => ({ getFirstTouch: () => mocks.firstTouch }));

// Ninguem sabia de onde vinha um cadastro nem em que lingua a pessoa usava o
// site. As duas coisas vao junto, nos metadados da conta (jsonb, sem migration).
describe("signUpWithEmail metadata", () => {
  const input = { displayName: " Ana Souza ", email: "ana@example.test", password: "irrelevant-here" };

  async function signUpMetadata(extra: { acceptedTerms?: boolean } = {}, confirmNext?: string) {
    mocks.signUp.mockResolvedValueOnce({
      data: { user: { id: "u-1", email: input.email, identities: [{}] }, session: null },
      error: null,
    });
    await signUpWithEmail({ ...input, locale: "es", ...extra }, undefined, confirmNext);
    return mocks.signUp.mock.calls.at(-1)?.[0].options.data;
  }

  it("records the UI language and the first touch alongside the name", async () => {
    mocks.firstTouch = { utm_source: "instagram", utm_campaign: "launch", referrer: "https://l.instagram.com" };

    expect(await signUpMetadata()).toEqual({
      display_name: "Ana Souza",
      name: "Ana Souza",
      locale: "es",
      utm_source: "instagram",
      utm_campaign: "launch",
      referrer: "https://l.instagram.com",
    });
  });

  it("sends what it has when there is no first touch", async () => {
    mocks.firstTouch = null;

    expect(await signUpMetadata()).toEqual({ display_name: "Ana Souza", name: "Ana Souza", locale: "es" });
  });

  // Onda F: o tique dos termos se perdia no cadastro com confirmacao de e-mail
  // (sem sessao, o perfil nao grava). Agora vai junto com a conta.
  it("keeps the accepted terms and privacy versions with the account", async () => {
    mocks.firstTouch = null;

    expect(await signUpMetadata({ acceptedTerms: true })).toMatchObject({
      terms_version: currentTermsVersion,
      privacy_version: currentPrivacyVersion,
    });
  });

  // O lembrete de 24 h le daqui o curso de onde a pessoa veio.
  it("keeps where the confirmation leads, but not the plain start or an oversized value", async () => {
    mocks.firstTouch = null;
    const course = "/welcome?path=student&returnTo=%2Fcourses%2Ffocus";

    expect(await signUpMetadata({}, course)).toMatchObject({ signup_next: course });
    expect(await signUpMetadata({}, "/welcome")).not.toHaveProperty("signup_next");
    expect(await signUpMetadata({}, `/welcome?returnTo=%2F${"x".repeat(400)}`)).not.toHaveProperty("signup_next");
  });
});

describe("getSignupLegalVersions", () => {
  it("reads the versions kept at signup, ignoring anything that is not text", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { user_metadata: { terms_version: "2026-09-24", privacy_version: 42 } } },
      error: null,
    });
    expect(await getSignupLegalVersions()).toEqual({ terms: "2026-09-24", privacy: undefined });
  });

  // A hora do aceite e a da criacao da conta (servidor), nao a do navegador.
  it("gives the account creation time as the acceptance time", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { created_at: "2026-10-05T10:00:00Z", user_metadata: { terms_version: "2026-09-24" } } },
      error: null,
    });
    expect(await getSignupLegalVersions()).toMatchObject({ acceptedAt: "2026-10-05T10:00:00Z" });
  });
});

// The confirm-your-email screen polls this. A confirmed session for ANOTHER
// account (signed in in another tab) must not count as "this email confirmed".
describe("refreshCurrentUserEmailVerification", () => {
  function sessionFor(email: string, confirmed = true) {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { email, email_confirmed_at: confirmed ? "2026-10-05T00:00:00Z" : null } },
      error: null,
    });
  }

  it("matches the expected email case-insensitively", async () => {
    sessionFor("Ana@Example.test");
    expect(await refreshCurrentUserEmailVerification("ana@example.TEST")).toBe(true);
  });

  it("ignores a confirmed session that belongs to someone else", async () => {
    sessionFor("other@example.test");
    expect(await refreshCurrentUserEmailVerification("ana@example.test")).toBe(false);
  });

  it("without an expected email, keeps answering for whoever is signed in", async () => {
    sessionFor("other@example.test");
    expect(await refreshCurrentUserEmailVerification()).toBe(true);
    sessionFor("other@example.test", false);
    expect(await refreshCurrentUserEmailVerification()).toBe(false);
  });
});

describe("getAuthErrorMessage", () => {
  it("maps invalid credentials by message, case-insensitively", () => {
    expect(
      getAuthErrorMessage({ message: "Invalid Login Credentials" }),
    ).toBe("Incorrect email or password.");
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

  it("maps confirmation email send failures by message", () => {
    expect(
      getAuthErrorMessage({ message: "Error sending confirmation email" }),
    ).toBe(
      "We could not send the confirmation email. Please try again in a few minutes or contact support.",
    );
  });

  it("maps generic server failures to neutral copy, not email copy", () => {
    const expected =
      "Something went wrong on our end. Please try again in a few minutes.";
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
