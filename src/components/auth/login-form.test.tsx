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

// Quem clica num plano em /pricing e ja tem conta entra por aqui: o plano vem
// em ?plan= e ?cycle=, ou ja como returnTo (o link "ja tenho conta" do
// cadastro). So professor sem plano abre a tela de cartao.
describe("LoginForm com um plano escolhido em /pricing", () => {
  const cartao = "/account/billing/upgrade?plan=starter&cycle=yearly";
  const comCartao = "returnTo=%2Faccount%2Fbilling%2Fupgrade%3Fplan%3Dstarter%26cycle%3Dyearly";

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
    ["professor sem plano abre o cartao", { onboardingCompleted: true, roles: ["teacher"] }, cartao],
    ["professor que ja tem plano segue para o estudio", { onboardingCompleted: true, roles: ["teacher"], currentPlanId: "basic" }, "/loading?next=route&path=teacher"],
    ["quem ainda nao ensina ativa o ensino levando o plano", { onboardingCompleted: true, roles: ["student"] }, `/onboarding?path=teacher&${comCartao}`],
    ["conta sem onboarding passa por ele levando o plano", { onboardingCompleted: false, roles: ["student"] }, `/loading?next=welcome&path=teacher&${comCartao}`],
  ])("%s", async (_caso, profile, destino) => {
    expect(await entrar(profile)).toBe(destino);
  });

  it("quem entra pela porta de aluno nao abre o cartao", async () => {
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: cartao });
    expect(await entrar({ onboardingCompleted: true, roles: ["teacher"] })).toBe("/loading?next=route&path=student");
  });

  it("plano fora da lista e ignorado: entra como sempre", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher&plan=plus&cycle=yearly");
    expect(await entrar({ onboardingCompleted: true, roles: ["teacher"] })).toBe("/loading?next=route&path=teacher");
  });

  it("leva o plano pela volta do Google", () => {
    render(<LoginForm />);

    clickGoogle();

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(`/loading?next=welcome&path=teacher&${comCartao}`);
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

describe("LoginForm: campo de senha e botao de e-mail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.searchParams = new URLSearchParams();
  });

  afterEach(cleanup);

  // A-10: com o link dentro do <label>, o leitor de tela lia o campo como
  // "Password Forgot password?".
  it("o campo se chama so 'Password', o link fica fora do rotulo e o olho alterna o tipo", () => {
    render(<LoginForm />);

    const field = screen.getByLabelText("auth.password");
    expect(field).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("link", { name: "auth.forgotPassword" }).closest("label")).toBeNull();

    const eye = screen.getByRole("button", { name: "auth.showPassword" });
    fireEvent.click(eye);
    expect(field).toHaveAttribute("type", "text");
    // Um nome so; o estado vem do aria-pressed.
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(eye).toHaveAccessibleName("auth.showPassword");
    expect(screen.getByRole("textbox", { name: "auth.password" })).toBe(field);
  });

  // A-09: o rotulo de espera so no botao apertado; os dois seguem travados.
  it("entrar com e-mail muda so o rotulo do botao de e-mail", async () => {
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
