import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeSkillsetPassword,
  signInWithGoogle,
} from "@/lib/auth/supabase-auth";

// The four GoTrue calls these tests care about, shaped like the Supabase
// client so getSupabaseBrowserClient() can hand the whole object back.
const mocks = vi.hoisted(() => {
  const fn = vi.fn;
  const auth = {
    getUser: fn(),
    updateUser: fn(),
    signInWithOAuth: fn(),
    signInWithPassword: fn(),
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
