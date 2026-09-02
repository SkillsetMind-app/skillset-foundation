import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  signInWithGoogle: vi.fn(),
  getPendingSecondFactor: vi.fn(),
  signOut: vi.fn(),
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
});

// A-17: quem fechava a tela do codigo ficava com a sessao aal1 no cookie. O
// provider agora expoe isso como `mfa_required` e manda para ca — entao esta
// tela tem que (1) retomar o desafio sozinha, sem pedir a senha de novo, e
// (2) ter uma saida que encerre a sessao de verdade, nao so esconda a tela.
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
