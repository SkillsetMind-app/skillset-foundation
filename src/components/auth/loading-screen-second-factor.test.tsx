import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "@/components/auth/loading-screen";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(
    "next=welcome&path=teacher&returnTo=%2Fteach%2Fsettings",
  ),
  getUserProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "mfa_required", user: null }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
}));

// /loading segura o spinner por 1.4s antes de rotear; esperar alem disso.
const ROUTED = { timeout: 4000 };

// A-17: o roteador pos-login mandava qualquer sessao com usuario para o
// conteudo. Senha aceita e codigo ainda nao apresentado tem que cair na tela
// do codigo — levando caminho e deep link junto, para nao se perderem.
describe("LoadingScreen com segundo fator pendente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("manda para a tela do codigo com caminho e deep link, nunca para o conteudo", async () => {
    render(<LoadingScreen />);

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith(
          "/login?path=teacher&returnTo=%2Fteach%2Fsettings",
        ),
      ROUTED,
    );
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });
});
