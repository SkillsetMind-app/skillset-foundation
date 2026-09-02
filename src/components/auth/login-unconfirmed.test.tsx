import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";

/**
 * Quem criou a conta e nunca clicou no link recebia, ao entrar, uma frase de
 * erro e ponto. Agora ve a mesma porta do cadastro — com "reenviar o link".
 */

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  getPendingSecondFactor: vi.fn(),
  signOut: vi.fn(),
  resendSignupConfirmation: vi.fn(),
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
  signInWithEmail: mocks.signInWithEmail,
  signInWithGoogle: mocks.signInWithGoogle,
  getPendingSecondFactor: mocks.getPendingSecondFactor,
  signOutOfSkillsetMind: mocks.signOut,
  resendSignupConfirmation: mocks.resendSignupConfirmation,
}));

vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn() }));

describe("LoginForm: e-mail nunca confirmado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.resendSignupConfirmation.mockResolvedValue(undefined);
    mocks.signInWithEmail.mockRejectedValue(
      Object.assign(new Error("Email not confirmed"), { code: "email_not_confirmed" }),
    );
  });

  afterEach(cleanup);

  it("mostra a porta de confirmacao com reenviar, nao uma frase de erro", async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("auth.email"), {
      target: { value: "patrick@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("auth.passwordPlaceholder"), {
      target: { value: "Skillset2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));

    expect(await screen.findByText("auth.signup.confirmTitle")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmResend" }));
    await waitFor(() =>
      expect(mocks.resendSignupConfirmation).toHaveBeenCalledWith("patrick@example.com"),
    );
  });

  it("'e-mail errado?' devolve o formulario de entrada", async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("auth.email"), {
      target: { value: "patrick@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("auth.passwordPlaceholder"), {
      target: { value: "Skillset2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "auth.signup.confirmChangeEmail" }),
    );

    expect(screen.getByRole("button", { name: "auth.signIn" })).toBeInTheDocument();
  });
});
