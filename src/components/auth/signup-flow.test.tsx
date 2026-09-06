import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupForm } from "@/components/auth/signup-form";

/**
 * O que a pessoa pedia no cadastro:
 *  - o olhinho nas DUAS senhas (o login tinha; o cadastro, onde mais importa,
 *    nao tinha);
 *  - depois de criar a conta, a porta "confirme seu e-mail" com REENVIAR e
 *    "trocar o e-mail" — antes era um beco sem saida ("va para o login").
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
    target: { value: "Patrick Simon" },
  });
  fireEvent.change(screen.getByLabelText("auth.email"), {
    target: { value: "patrick@example.com" },
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

describe("SignupForm: o olhinho e a porta de confirmacao", () => {
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

  it("cada senha tem o seu olhinho, e ele mostra so aquele campo", () => {
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
    expect(screen.getByRole("button", { name: "auth.hidePassword" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "auth.showPassword" }));
    expect(second.type).toBe("text");
  });

  it("conta criada sem sessao: a porta de confirmacao, com reenviar e espera de 60 s", async () => {
    render(<SignupForm />);
    fillStepOne();
    fillStepTwoAndSubmit();

    expect(await screen.findByText("auth.signup.confirmTitle")).toBeInTheDocument();
    expect(screen.getByText("patrick@example.com")).toBeInTheDocument();
    expect(mocks.router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmResend" }));
    await waitFor(() =>
      expect(mocks.resendSignupConfirmation).toHaveBeenCalledWith("patrick@example.com"),
    );
    expect(await screen.findByText("auth.signup.confirmResent")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /auth\.signup\.confirmResendIn/ }),
    ).toBeDisabled();
  });

  it("'e-mail errado?' volta ao formulario com o que a pessoa ja digitou", async () => {
    render(<SignupForm />);
    fillStepOne();
    fillStepTwoAndSubmit();

    fireEvent.click(
      await screen.findByRole("button", { name: "auth.signup.confirmChangeEmail" }),
    );

    expect(screen.getByLabelText("auth.email")).toHaveValue("patrick@example.com");
    expect(screen.getByLabelText("auth.signup.fullName")).toHaveValue("Patrick Simon");
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
