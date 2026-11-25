import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  signInWithGoogle: vi.fn(),
  getPendingSecondFactor: vi.fn(),
  signOut: vi.fn(),
  resend: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));

vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signInWithEmail: vi.fn(),
  signInWithGoogle: mocks.signInWithGoogle,
  getPendingSecondFactor: mocks.getPendingSecondFactor,
  signOutOfSkillsetMind: mocks.signOut,
  resendSignupConfirmation: mocks.resend,
}));

vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn() }));

import { MfaRequiredError, signInWithEmail } from "@/lib/auth/supabase-auth";
import { getUserProfile } from "@/lib/data/user-profiles";

function clickGoogle() {
  fireEvent.click(
    screen.getByRole("button", { name: /auth\.continueWithGoogle/ }),
  );
}

// Whoever clicks a plan on /pricing and already has an account comes in through here: the plan comes
// in ?plan= and ?cycle=, or already as returnTo (the "I already have an account" link on
// signup). Only a teacher without a plan opens the card screen.
describe("LoginForm with a plan chosen on /pricing", () => {
  const card = "/account/billing/upgrade?plan=starter&cycle=yearly";
  const withCard = "returnTo=%2Faccount%2Fbilling%2Fupgrade%3Fplan%3Dstarter%26cycle%3Dyearly";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
    vi.mocked(signInWithEmail).mockResolvedValue({ uid: "u-1" } as never);
    mocks.searchParams = new URLSearchParams("path=teacher&plan=starter&cycle=yearly");
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams = new URLSearchParams();
  });

  async function entrar(profile: Record<string, unknown>) {
    vi.mocked(getUserProfile).mockResolvedValue(profile as never);
    const view = render(<LoginForm />);
    fireEvent.change(view.container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.change(view.container.querySelector('input[type="password"]')!, { target: { value: "fixture-password" } });
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledTimes(1));
    return mocks.router.push.mock.calls[0][0];
  }

  it.each([
    ["teacher without a plan opens the card", { onboardingCompleted: true, roles: ["teacher"] }, card],
    ["teacher who already has a plan goes on to the studio",{ onboardingCompleted: true, roles: ["teacher"], currentPlanId: "basic" }, "/loading?next=route&path=teacher"],
    ["someone who does not teach yet turns on teaching carrying the plan", { onboardingCompleted: true, roles: ["student"] }, `/onboarding?path=teacher&${withCard}`],
    ["account without onboarding goes through it carrying the plan",{ onboardingCompleted: false, roles: ["student"] }, `/loading?next=welcome&path=teacher&${withCard}`],
  ])("%s", async (_caso, profile, redirectTarget) => {
    expect(await entrar(profile)).toBe(redirectTarget);
  });

  it("whoever enters through the learner door does not open the card screen", async () => {
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: card });
    expect(await entrar({ onboardingCompleted: true, roles: ["teacher"] })).toBe("/loading?next=route&path=student");
  });

  it("a plan outside the list is ignored: signs in as usual", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher&plan=plus&cycle=yearly");
    expect(await entrar({ onboardingCompleted: true, roles: ["teacher"] })).toBe("/loading?next=route&path=teacher");
  });

  it("carries the plan through the Google round trip", () => {
    render(<LoginForm />);

    clickGoogle();

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(`/loading?next=welcome&path=teacher&${withCard}`);
  });
});

describe("LoginForm with Google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real call navigates the browser away and never resolves.
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.searchParams = new URLSearchParams();
  });

  afterEach(cleanup);

  // The reported bug: the deep link the sign-in wall captured was read here
  // and then never used — Google sign-in always landed on "/".
  it("carries the captured deep link and path into the OAuth round trip", () => {
    mocks.searchParams = new URLSearchParams(
      "path=student&returnTo=%2Flearn%2Fcourses%2Fx",
    );
    render(<LoginForm />);

    clickGoogle();

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "/loading?next=welcome&path=student&returnTo=%2Flearn%2Fcourses%2Fx",
    );
  });

  it("still routes through /loading when there is no deep link", () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    render(<LoginForm />);

    clickGoogle();

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "/loading?next=welcome&path=teacher",
    );
  });

  it.each([
    ["/courses/focus/checkout?offer=LAUNCH&priceId=price-1", "/courses/focus/checkout?offer=LAUNCH&priceId=price-1"],
    ["https://outside.example/checkout", null],
    ["//outside.example/checkout", null],
    ["/\\outside.example/checkout", null],
    ["/auth?mode=signup", null],
  ])("keeps only a safe destination in the create-account link: %s", (returnTo, expected) => {
    mocks.searchParams = new URLSearchParams({
      path: "teacher", returnTo: returnTo!, next: "https://outside.example", external: "discard",
    });
    render(<LoginForm />);
    const destination = new URL(screen.getByRole("link", { name: "auth.createAccount" }).getAttribute("href")!, "https://skillset.test");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("mode")).toBe("signup");
    expect(destination.searchParams.get("path")).toBe("teacher");
    expect(destination.searchParams.get("returnTo")).toBe(expected);
    expect(destination.searchParams.has("next")).toBe(false);
    expect(destination.searchParams.has("external")).toBe(false);
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
  });
});

describe("LoginForm: password field and email button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.searchParams = new URLSearchParams();
  });

  afterEach(cleanup);

  // A-10: with the link inside the <label>, the screen reader read the field as
  // "Password Forgot password?".
  it("the field is named just 'Password', the link stays outside the label and the eye toggles the type", () => {
    render(<LoginForm />);

    const field = screen.getByLabelText("auth.password");
    expect(field).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("link", { name: "auth.forgotPassword" }).closest("label")).toBeNull();

    const eye = screen.getByRole("button", { name: "auth.showPassword" });
    fireEvent.click(eye);
    expect(field).toHaveAttribute("type", "text");
    // A single name; the state comes from aria-pressed.
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(eye).toHaveAccessibleName("auth.showPassword");
    expect(screen.getByRole("textbox", { name: "auth.password" })).toBe(field);
  });

  // A-09: the wait label only on the pressed button; both stay locked.
  it("signing in with email changes only the label of the email button", async () => {
    vi.mocked(signInWithEmail).mockReturnValue(new Promise(() => {}) as never);
    const view = render(<LoginForm />);
    fireEvent.change(view.container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.change(screen.getByLabelText("auth.password"), { target: { value: "fixture-password" } });
    fireEvent.submit(view.container.querySelector("form")!);

    expect(await screen.findByRole("button", { name: "auth.signingIn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /auth\.continueWithGoogle/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /auth\.openingGoogle/ })).toBeNull();
  });
});

// A-17: whoever closed the code screen was left with the aal1 session in the cookie. The
// provider now exposes this as `mfa_required` and sends them here — so this
// screen has to (1) resume the challenge on its own, without asking for the password again, and
// (2) have an exit that really ends the session, not just hide the screen.
describe("LoginForm with a session ended by the account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
  });

  afterEach(cleanup);

  // The proxy drops the revoked session and sends them here with ?error=session_revoked.
  // Without its own sentence, it fell into "invalid or expired link", which explains nothing.
  it("says why the person was signed out, instead of talking about an expired link", () => {
    mocks.searchParams = new URLSearchParams("error=session_revoked");
    render(<LoginForm />);

    expect(screen.getByText("authFlow.errors.sessionRevoked")).toBeTruthy();
    expect(screen.queryByText("authFlow.callback.invalidOrExpired")).toBeNull();
  });
});

describe("LoginForm with a pending second factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(
      new MfaRequiredError("factor-1"),
    );
    mocks.signOut.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("resumes the code screen on mount when the aal1 session stayed in the cookie", async () => {
    render(<LoginForm />);

    expect(await screen.findByLabelText(/auth\.mfaCodeLabel/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /auth\.continueWithGoogle/ }),
    ).toBeNull();
  });

  it("'use another account' (a text-only button) has at least 24px of area", async () => {
    render(<LoginForm />);
    await screen.findByLabelText(/auth\.mfaCodeLabel/);

    expect(
      screen.getByRole("button", { name: /auth\.useDifferentAccount/ }).className,
    ).toContain("min-h-6");
  });

  it("'use another account' really signs out before going back to the password form", async () => {
    render(<LoginForm />);
    await screen.findByLabelText(/auth\.mfaCodeLabel/);

    fireEvent.click(
      screen.getByRole("button", { name: /auth\.useDifferentAccount/ }),
    );

    expect(
      await screen.findByRole("button", { name: /auth\.continueWithGoogle/ }),
    ).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});

// Wave F: expired or already used confirmation link. Before, it fell into a sentence about
// "reset links" (password reset) with no way to ask for another. Now: the
// resend screen, with the same answer for any email, so nobody finds out
// who has signed up.
describe("LoginForm with an expired confirmation link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.resend.mockResolvedValue(undefined);
    mocks.searchParams = new URLSearchParams(
      "error=confirm_expired&path=student&returnTo=%2Fcourses%2Ffocus",
    );
  });

  afterEach(cleanup);

  function askForNewLink() {
    fireEvent.change(screen.getByLabelText("auth.email"), {
      target: { value: "ana@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth.signup.expiredSend" }));
  }

  it("shows the ask-for-another-link screen, not the password reset text", () => {
    render(<LoginForm />);

    expect(screen.getByRole("heading", { name: "auth.signup.expiredTitle" })).toBeTruthy();
    expect(screen.getByText("auth.signup.expiredBody")).toBeTruthy();
    expect(screen.queryByText("authFlow.callback.usedOrExpired")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resends through the existing resend, for the same course, with the 60 s wait", async () => {
    render(<LoginForm />);
    askForNewLink();

    expect(await screen.findByText("auth.signup.expiredSent")).toBeTruthy();
    expect(mocks.resend).toHaveBeenCalledWith(
      "ana@example.test",
      "/loading?next=welcome&path=student&returnTo=%2Fcourses%2Ffocus",
      undefined,
    );
    expect(
      screen.getByRole("button", { name: "auth.signup.confirmResendIn" }),
    ).toHaveProperty("disabled", true);
  });

  it.each([
    ["the send limit",{ code: "over_email_send_rate_limit", status: 429 }],
    ["account that does not exist", { code: "user_not_found", status: 404 }],
    ["email server failure", { message: "Error sending confirmation email", status: 500 }],
  ])("answers %s with the same sent sentence", async (_label, error) => {
    mocks.resend.mockRejectedValue(error);
    render(<LoginForm />);
    askForNewLink();

    expect(await screen.findByText("auth.signup.expiredSent")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the CAPTCHA failure, which says nothing about the account", async () => {
    mocks.resend.mockRejectedValue({ message: "captcha protection: request disallowed" });
    render(<LoginForm />);
    askForNewLink();

    expect(await screen.findByText("authFlow.errors.captcha")).toBeTruthy();
    expect(screen.queryByText("auth.signup.expiredSent")).toBeNull();
  });

  it("'already confirmed? sign in' opens the form with the typed email", () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("auth.email"), {
      target: { value: "ana@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmSignIn" }));

    expect(screen.getByDisplayValue("ana@example.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "auth.signIn" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.resend).not.toHaveBeenCalled();
  });
});
