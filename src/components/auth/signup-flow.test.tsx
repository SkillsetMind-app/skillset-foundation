import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupForm } from "@/components/auth/signup-form";

/**
 * What the person asked for on signup:
 *  - the little eye on BOTH passwords (login had it; signup, where it matters most,
 *    did not);
 *  - after creating the account, the "confirm your email" gate with RESEND and
 *    "change the email" — before it was a dead end ("go to login").
 */

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  signUpWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  resendSignupConfirmation: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signUpWithEmail: mocks.signUpWithEmail,
  signInWithGoogle: mocks.signInWithGoogle,
  resendSignupConfirmation: mocks.resendSignupConfirmation,
}));

vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));

vi.mock("@/lib/data/user-profiles", () => ({
  acceptUserTerms: vi.fn(() => Promise.resolve()),
  updateUserIdentity: vi.fn(() => Promise.resolve()),
  getUserProfile: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: { userSignedUp: vi.fn() },
}));

vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));

const strongSecret = "Skillset2026!";
const secretField = "password";

function fillStepOne() {
  fireEvent.change(screen.getByLabelText("auth.signup.fullName"), {
    target: { value: "Preston Sloan" },
  });
  fireEvent.change(screen.getByLabelText("auth.email"), {
    target: { value: "preston@example.com" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "auth.signup.continue" }));
}

function fillStepTwoAndSubmit() {
  fireEvent.change(screen.getByLabelText("auth." + secretField), {
    target: { value: strongSecret },
  });
  fireEvent.change(screen.getByLabelText("auth.signup.confirmPassword"), {
    target: { value: strongSecret },
  });
  fireEvent.click(screen.getByRole("button", { name: "auth.signup.createAccount" }));
}

describe("SignupForm: the little eye and the confirmation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.resendSignupConfirmation.mockResolvedValue(undefined);
    mocks.signUpWithEmail.mockResolvedValue({
      user: { uid: "u-1" },
      needsEmailConfirmation: true,
    });
  });

  afterEach(cleanup);

  it("each password has its own little eye, and it shows only that field", () => {
    render(<SignupForm />);
    fillStepOne();

    const first = screen.getByLabelText("auth." + secretField) as HTMLInputElement;
    const second = screen.getByLabelText("auth.signup.confirmPassword") as HTMLInputElement;
    const eyes = screen.getAllByRole("button", { name: "auth.showPassword" });
    expect(eyes).toHaveLength(2);
    expect(first.type).toBe(secretField);
    expect(second.type).toBe(secretField);

    fireEvent.click(eyes[0]);
    expect(first.type).toBe("text");
    expect(second.type).toBe(secretField);
    // A single name; the state comes from aria-pressed.
    expect(eyes[0]).toHaveAttribute("aria-pressed", "true");
    expect(eyes[1]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: "auth.showPassword" })).toHaveLength(2);

    fireEvent.click(eyes[1]);
    expect(second.type).toBe("text");
    // The accessible name of the field is only the label, without the button's.
    expect(screen.getByRole("textbox", { name: "auth." + secretField })).toBe(first);
    expect(screen.getByRole("textbox", { name: "auth.signup.confirmPassword" })).toBe(second);
  });

  // A-09: the wait label follows the clicked method. "Back" stays active
  // during account creation; going back to step 1 in the middle of the request, the
  // Google button said "Opening Google..." without having been clicked.
  it("only the clicked Google says 'Opening Google...'; going back mid-creation does not", async () => {
    mocks.signUpWithEmail.mockReturnValue(new Promise(() => {}));
    render(<SignupForm />);
    fillStepOne();
    fillStepTwoAndSubmit();

    expect(await screen.findByRole("button", { name: "auth.signup.creatingAccount" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "auth.signup.back" }));
    expect(screen.getByRole("button", { name: /auth\.continueWithGoogle/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /auth\.openingGoogle/ })).toBeNull();
  });

  it("clicking Google changes its label", () => {
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
    render(<SignupForm />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /auth\.continueWithGoogle/ }));

    expect(screen.getByRole("button", { name: /auth\.openingGoogle/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "auth.signup.continue" })).toBeDisabled();
  });

  // A-10: inside the <label>, the sentence became part of the field name.
  it("different passwords: the notice stays outside the label and describes the field", () => {
    render(<SignupForm />);
    fillStepOne();

    fireEvent.change(screen.getByLabelText("auth." + secretField), {
      target: { value: strongSecret },
    });
    const confirm = screen.getByLabelText("auth.signup.confirmPassword");
    fireEvent.change(confirm, { target: { value: "different" } });

    const warning = screen.getByText("auth.signup.passwordsDontMatch");
    expect(warning.closest("label")).toBeNull();
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAttribute("aria-describedby", warning.id);
  });

  // F-12: a grayed-out "Create account" said nothing. Now it says what is missing, tied
  // to the button; different passwords point to the notice that already exists.
  it("the grayed-out button of step 2 says what is missing, tied to it", () => {
    render(<SignupForm />);
    fillStepOne();
    const create = screen.getByRole("button", { name: "auth.signup.createAccount" });
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription("auth.signup.choosePasswordFirst");

    fireEvent.change(screen.getByLabelText("auth." + secretField), { target: { value: strongSecret } });
    expect(create).toHaveAccessibleDescription("auth.signup.confirmPasswordFirst");

    const confirm = screen.getByLabelText("auth.signup.confirmPassword");
    fireEvent.change(confirm, { target: { value: "different" } });
    expect(create).toHaveAccessibleDescription("auth.signup.passwordsDontMatch");
    expect(screen.getAllByText("auth.signup.passwordsDontMatch")).toHaveLength(1);

    fireEvent.change(confirm, { target: { value: strongSecret } });
    expect(create).toBeEnabled();
    expect(create).not.toHaveAttribute("aria-describedby");
  });

  it("account created without a session: the confirmation gate, with resend and a 60 s wait", async () => {
    render(<SignupForm />);
    fillStepOne();
    fillStepTwoAndSubmit();

    expect(await screen.findByText("auth.signup.confirmWaiting")).toBeInTheDocument();
    expect(screen.getByText("preston@example.com")).toBeInTheDocument();
    expect(mocks.router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmResend" }));
    await waitFor(() =>
      expect(mocks.resendSignupConfirmation).toHaveBeenCalledWith(
        "preston@example.com",
        "/loading?next=welcome&path=student",
        undefined,
      ),
    );
    expect(await screen.findByText("auth.signup.confirmResent")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /auth\.signup\.confirmResendIn/ }),
    ).toBeDisabled();
  });

  it("'wrong email?' goes back to the form with what the person already typed", async () => {
    render(<SignupForm />);
    fillStepOne();
    fillStepTwoAndSubmit();

    fireEvent.click(
      await screen.findByRole("button", { name: "auth.signup.confirmChangeEmail" }),
    );

    expect(screen.getByLabelText("auth.email")).toHaveValue("preston@example.com");
    expect(screen.getByLabelText("auth.signup.fullName")).toHaveValue("Preston Sloan");
  });

  it("keeps intent and the checkout offer when leaving the confirmation gate for sign-in", async () => {
    const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: checkout });
    render(<SignupForm />);
    fillStepOne();
    fillStepTwoAndSubmit();
    const signin = await screen.findByRole("link", { name: "auth.signup.confirmSignIn" });
    const destination = new URL(signin.getAttribute("href")!, "https://skillset.test");
    expect(destination.searchParams.get("mode")).toBe("signin");
    expect(destination.searchParams.get("path")).toBe("student");
    expect(destination.searchParams.get("returnTo")).toBe(checkout);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.resendSignupConfirmation).not.toHaveBeenCalled();
  });
});
