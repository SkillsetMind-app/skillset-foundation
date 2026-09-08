import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage } from "@/components/auth/auth-page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AuthSession } from "@/domain/auth";
import type { Locale } from "@/lib/i18n/config";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(),
  auth: { status: "unauthenticated", user: null } as AuthSession,
  googleEnabled: false,
  signInWithGoogle: vi.fn(),
  getPendingSecondFactor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth/providers", () => ({
  // Getter, e nao valor: a flag do Google muda entre os casos deste arquivo.
  get isGoogleAuthEnabled() {
    return mocks.googleEnabled;
  },
}));
vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signInWithGoogle: mocks.signInWithGoogle,
  getPendingSecondFactor: mocks.getPendingSecondFactor,
}));
vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn() }));

const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
const checkoutEncoded =
  "%2Fcourses%2Ffocus%2Fcheckout%3Foffer%3DLAUNCH%26priceId%3Dprice-1";

function renderAt(query: string, locale: Locale = "en") {
  mocks.searchParams = new URLSearchParams(query);
  return render(
    <I18nProvider initialLocale={locale}>
      <AuthPage />
    </I18nProvider>,
  );
}

// A tela ja era dividida por papel, mas o papel so aparecia num eyebrow miudo
// sob um titulo generico, e nao havia como trocar. Quem entrava pela porta
// errada nao percebia.
describe("entrada de login por papel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: "unauthenticated", user: null };
    mocks.googleEnabled = false;
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    // A chamada real navega para fora e nunca resolve.
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
  });

  afterEach(cleanup);

  it.each([
    [
      "mode=signin&path=student",
      "Sign in as a learner.",
      "Entra como estudiante.",
    ],
    [
      "mode=signin&path=teacher",
      "Sign in as an educator.",
      "Entra como educador.",
    ],
    [
      "mode=signup&path=student",
      "Create your learner account.",
      "Crea tu cuenta de estudiante.",
    ],
    [
      "mode=signup&path=teacher",
      "Create your educator account.",
      "Crea tu cuenta de educador.",
    ],
  ])("o titulo diz o papel em %s (EN e ES)", (query, emIngles, emEspanhol) => {
    renderAt(query);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(emIngles);

    cleanup();
    renderAt(query, "es");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      emEspanhol,
    );
  });

  it.each([
    ["student", "teacher", "Are you an educator? Sign in here"],
    ["teacher", "student", "Are you a learner? Sign in here"],
  ])(
    "de %s oferece a troca para %s sem perder o destino capturado",
    (papel, outroPapel, rotulo) => {
      renderAt(`mode=signin&path=${papel}&returnTo=${checkoutEncoded}`);

      const destino = new URL(
        screen.getByRole("link", { name: rotulo }).getAttribute("href")!,
        "https://skillset.test",
      );
      expect(destino.pathname).toBe("/auth");
      expect(destino.searchParams.get("mode")).toBe("signin");
      expect(destino.searchParams.get("path")).toBe(outroPapel);
      expect(destino.searchParams.get("returnTo")).toBe(checkout);
    },
  );

  it("esconde o Google enquanto a flag do provedor estiver desligada", () => {
    renderAt("mode=signin&path=teacher");

    expect(
      screen.queryByRole("button", { name: /Continue with Google/ }),
    ).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
  });

  it("com a flag ligada, o Google abre o formulario e leva papel e destino", () => {
    mocks.googleEnabled = true;
    const view = renderAt(`mode=signin&path=teacher&returnTo=${checkoutEncoded}`);

    const google = screen.getByRole("button", { name: /Continue with Google/ });
    const email = view.container.querySelector('input[type="email"]')!;
    expect(screen.getByText("or")).toBeInTheDocument();
    expect(
      google.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(google);

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      `/loading?next=welcome&path=teacher&returnTo=${checkoutEncoded}`,
    );
  });
});
