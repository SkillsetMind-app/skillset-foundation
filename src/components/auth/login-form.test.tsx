import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { MfaRequiredError } from "@/lib/auth/supabase-auth";

function clickGoogle() {
  fireEvent.click(
    screen.getByRole("button", { name: /auth\.continueWithGoogle/ }),
  );
}

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

// A-17: quem fechava a tela do codigo ficava com a sessao aal1 no cookie. O
// provider agora expoe isso como `mfa_required` e manda para ca — entao esta
// tela tem que (1) retomar o desafio sozinha, sem pedir a senha de novo, e
// (2) ter uma saida que encerre a sessao de verdade, nao so esconda a tela.
describe("LoginForm com sessao encerrada pela conta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
  });

  afterEach(cleanup);

  // O proxy derruba a sessao revogada e manda para ca com ?error=session_revoked.
  // Sem a frase propria, caia em "link invalido ou expirado", que nao explica nada.
  it("diz por que a pessoa saiu, em vez de falar de link expirado", () => {
    mocks.searchParams = new URLSearchParams("error=session_revoked");
    render(<LoginForm />);

    expect(screen.getByText("authFlow.errors.sessionRevoked")).toBeTruthy();
    expect(screen.queryByText("authFlow.callback.invalidOrExpired")).toBeNull();
  });
});

describe("LoginForm com segundo fator pendente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(
      new MfaRequiredError("factor-1"),
    );
    mocks.signOut.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("retoma a tela do codigo ao montar quando a sessao aal1 ficou no cookie", async () => {
    render(<LoginForm />);

    expect(await screen.findByLabelText(/auth\.mfaCodeLabel/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /auth\.continueWithGoogle/ }),
    ).toBeNull();
  });

  it("'usar outra conta' (botao so de texto) tem pelo menos 24px de area", async () => {
    render(<LoginForm />);
    await screen.findByLabelText(/auth\.mfaCodeLabel/);

    expect(
      screen.getByRole("button", { name: /auth\.useDifferentAccount/ }).className,
    ).toContain("min-h-6");
  });

  it("'usar outra conta' sai de verdade antes de voltar ao formulario de senha", async () => {
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

// Onda F: link de confirmacao vencido ou ja usado. Antes caia numa frase sobre
// "reset links" (troca de senha) e sem jeito de pedir outro. Agora: a tela de
// reenviar, com a mesma resposta para qualquer e-mail, para ninguem descobrir
// quem tem cadastro.
describe("LoginForm com link de confirmacao vencido", () => {
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

  it("mostra a tela de pedir outro link, e nao o texto de troca de senha", () => {
    render(<LoginForm />);

    expect(screen.getByRole("heading", { name: "auth.signup.expiredTitle" })).toBeTruthy();
    expect(screen.getByText("auth.signup.expiredBody")).toBeTruthy();
    expect(screen.queryByText("authFlow.callback.usedOrExpired")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reenvia pelo reenvio que ja existe, para o mesmo curso, com a espera de 60 s", async () => {
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
    ["o limite de envios", { code: "over_email_send_rate_limit", status: 429 }],
    ["conta que nao existe", { code: "user_not_found", status: 404 }],
    ["falha do servidor de e-mail", { message: "Error sending confirmation email", status: 500 }],
  ])("responde %s com a mesma frase de enviado", async (_label, error) => {
    mocks.resend.mockRejectedValue(error);
    render(<LoginForm />);
    askForNewLink();

    expect(await screen.findByText("auth.signup.expiredSent")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mostra a falha do CAPTCHA, que nao diz nada sobre a conta", async () => {
    mocks.resend.mockRejectedValue({ message: "captcha protection: request disallowed" });
    render(<LoginForm />);
    askForNewLink();

    expect(await screen.findByText("authFlow.errors.captcha")).toBeTruthy();
    expect(screen.queryByText("auth.signup.expiredSent")).toBeNull();
  });

  it("'ja confirmou? entrar' abre o formulario com o e-mail digitado", () => {
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
