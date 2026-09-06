import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeSkillsetPassword,
  resendSignupConfirmation,
  signInWithGoogle,
} from "@/lib/auth/supabase-auth";

// The GoTrue calls these tests care about, shaped like the Supabase
// client so getSupabaseBrowserClient() can hand the whole object back.
const mocks = vi.hoisted(() => {
  const fn = vi.fn;
  const auth = {
    getUser: fn(),
    updateUser: fn(),
    signInWithOAuth: fn(),
    signInWithPassword: fn(),
    resend: fn(),
  };
  return { auth, client: { auth } };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => mocks.client,
}));

// The breach check is a network call to HIBP — not what these tests are about.
vi.mock("@/lib/auth/pwned-password", () => ({
  assertPasswordNotBreached: vi.fn().mockResolvedValue(undefined),
}));

type OAuthCall = { options: { redirectTo: string } };
type PasswordCall = { options?: { captchaToken: string } };
type UpdateCall = { password: string };

describe("resendSignupConfirmation destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.resend.mockResolvedValue({ error: null });
  });

  it("carries the post-confirmation destination into the resent email", async () => {
    const destination = "/loading?next=welcome&path=teacher&returnTo=%2Fcourses%2Ffocus%2Fcheckout%3Foffer%3DLAUNCH%26priceId%3Dprice-1";
    await resendSignupConfirmation("learner@example.test", destination);

    const [call] = mocks.auth.resend.mock.calls[0];
    const redirectTo = new URL(call.options.emailRedirectTo);
    expect(call.type).toBe("signup");
    expect(call.email).toBe("learner@example.test");
    expect(redirectTo.origin).toBe(window.location.origin);
    expect(redirectTo.pathname).toBe("/auth/confirm");
    expect(redirectTo.searchParams.get("next")).toBe(destination);
  });

  it("defaults to onboarding when no destination was supplied", async () => {
    await resendSignupConfirmation("learner@example.test");
    const [call] = mocks.auth.resend.mock.calls[0];
    const redirectTo = new URL(call.options.emailRedirectTo);
    expect(redirectTo.pathname).toBe("/auth/confirm");
    expect(redirectTo.searchParams.get("next")).toBe("/welcome");
  });

  it.each(["over_email_send_rate_limit", "unexpected_failure"])("propagates provider errors without retrying: %s", async (code) => {
    const error = { code, message: "Provider detail" };
    mocks.auth.resend.mockResolvedValue({ error });
    await expect(resendSignupConfirmation("learner@example.test")).rejects.toBe(error);
    expect(mocks.auth.resend).toHaveBeenCalledTimes(1);
  });
});

describe("signInWithGoogle destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.signInWithOAuth.mockResolvedValue({ error: null });
  });

  // The reported bug: the redirect carried no destination, /auth/callback fell
  // back to "/", and every Google sign-in skipped onboarding and lost its
  // deep link.
  it("carries the post-login destination through the OAuth redirect", async () => {
    const destination =
      "/loading?next=welcome&path=student&returnTo=%2Flearn%2Fcourses%2Fx";

    // Never resolves by design (the browser is navigating away).
    void signInWithGoogle(destination);
    await vi.waitFor(() =>
      expect(mocks.auth.signInWithOAuth).toHaveBeenCalled(),
    );

    const [call] = mocks.auth.signInWithOAuth.mock.calls[0] as [OAuthCall];
    const redirectTo = new URL(call.options.redirectTo);
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe(destination);
  });
});

describe("changeSkillsetPassword under CAPTCHA protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.getUser.mockResolvedValue({
      data: { user: { email: "learner@example.com" } },
    });
    mocks.auth.signInWithPassword.mockResolvedValue({ error: null });
    mocks.auth.updateUser.mockResolvedValue({ error: null });
  });

  // With Attack Protection on, GoTrue refuses a password sign-in that carries
  // no token — and the re-authentication here is one.
  it("passes the captcha token to the re-authentication sign-in", async () => {
    await changeSkillsetPassword("OldPass1!", "NewPass2!", "cf-1");

    const [reauth] = mocks.auth.signInWithPassword.mock.calls[0] as [
      PasswordCall,
    ];
    expect(reauth.options).toEqual({ captchaToken: "cf-1" });

    const [update] = mocks.auth.updateUser.mock.calls[0] as [UpdateCall];
    expect(update.password).toBe("NewPass2!");
  });

  it("sends no options at all when there is no captcha in play", async () => {
    await changeSkillsetPassword("OldPass1!", "NewPass2!");

    const [reauth] = mocks.auth.signInWithPassword.mock.calls[0] as [
      PasswordCall,
    ];
    expect(reauth.options).toBeUndefined();
  });
});
