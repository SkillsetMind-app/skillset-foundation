import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupForm } from "@/components/auth/signup-form";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  signUpWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  acceptUserTerms: vi.fn(),
  updateUserIdentity: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Only the network call is faked. The error predicates and message keys stay real,
// because which branch a GoTrue error takes is what the reported bug was about.
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signUpWithEmail: mocks.signUpWithEmail,
  signInWithGoogle: mocks.signInWithGoogle,
}));

vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));

vi.mock("@/lib/data/user-profiles", () => ({
  acceptUserTerms: mocks.acceptUserTerms,
  updateUserIdentity: mocks.updateUserIdentity,
  getUserProfile: mocks.getUserProfile,
}));

vi.mock("@/lib/posthog/events", () => ({
  track: { userSignedUp: vi.fn() },
}));

vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));

const strongSecret = "Skillset2026!";

// Walks both wizard steps and presses "Create account".
function submitSignup() {
  fireEvent.change(screen.getByLabelText("auth.signup.fullName"), {
    target: { value: "Patrick Simon" },
  });
  fireEvent.change(screen.getByLabelText("auth.email"), {
    target: { value: "patrick@example.com" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "auth.signup.continue" }));

  fireEvent.change(screen.getByLabelText("auth.password"), {
    target: { value: strongSecret },
  });
  fireEvent.change(screen.getByLabelText("auth.signup.confirmPassword"), {
    target: { value: strongSecret },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "auth.signup.createAccount" }),
  );
}

describe("SignupForm once the account exists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.signUpWithEmail.mockResolvedValue({
      user: { uid: "u-1" },
      needsEmailConfirmation: false,
    });
    mocks.acceptUserTerms.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // The reported bug: Auth had already created the account, the terms write
  // failed, and the form reported a signup failure. Pressing the button again
  // could only answer "already exists".
  it("still goes to /welcome when the terms write fails", async () => {
    mocks.acceptUserTerms.mockRejectedValue(new Error("row-level security"));
    render(<SignupForm />);

    submitSignup();

    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith("/welcome?path=student"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("still goes to /welcome when the username write fails", async () => {
    mocks.updateUserIdentity.mockRejectedValue(new Error("network down"));
    render(<SignupForm />);

    submitSignup();

    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith("/welcome?path=student"),
    );
    expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("writes terms and a derived username on the happy path", async () => {
    render(<SignupForm />);

    submitSignup();

    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith("/welcome?path=student"),
    );
    expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false);
    // A compound name used to come out as "patrick simon" — a handle the
    // profile validator itself refuses.
    expect(mocks.updateUserIdentity).toHaveBeenCalledWith("u-1", {
      displayName: "Patrick Simon",
      username: "patrick-simon",
    });
  });
});

describe("SignupForm when the account was not created", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("points an existing email to sign-in instead of a dead end", async () => {
    mocks.signUpWithEmail.mockRejectedValue({
      code: "user_already_exists",
      message: "User already registered",
      status: 422,
    });
    render(<SignupForm />);

    submitSignup();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("authFlow.errors.accountExists");
    expect(
      screen.getByRole("link", { name: "auth.signup.existingAccountSignIn" }),
    ).toHaveAttribute("href", "/auth?mode=signin&path=student");
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
  });

  it("keeps other signup failures as plain errors", async () => {
    mocks.signUpWithEmail.mockRejectedValue({
      message: "Network request failed",
      status: 500,
    });
    render(<SignupForm />);

    submitSignup();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/./);
    expect(
      screen.queryByRole("link", { name: "auth.signup.existingAccountSignIn" }),
    ).toBeNull();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });
});

describe("SignupForm with Google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real call navigates the browser away and never resolves.
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
  });

  afterEach(cleanup);

  // A brand-new Google account used to land on "/" with onboarding never
  // completed — the callback had no destination to forward.
  it("sends a Google signup through /loading so onboarding runs", () => {
    render(<SignupForm />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: /auth\.continueWithGoogle/ }),
    );

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "/loading?next=welcome&path=student",
    );
  });
});

// O bug: quem apertava "matricular" sem conta ia criar conta com o curso na
// URL (returnTo). A tela de ENTRAR respeitava esse endereco; o CADASTRO nao —
// jogava a pessoa em /welcome sem ele, e ela terminava no painel, longe do
// curso que ia comprar. A venda morria entre duas telas.
describe("SignupForm leva o curso junto para o cadastro", () => {
  const destino = "/courses/focus";
  const paraOnboarding = "/welcome?path=student&returnTo=%2Fcourses%2Ffocus";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signUpWithEmail.mockResolvedValue({
      user: { uid: "u-1" },
      needsEmailConfirmation: false,
    });
    mocks.acceptUserTerms.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    // Os outros blocos contam com a URL limpa.
    mocks.searchParams = new URLSearchParams();
  });

  it("manda o destino adiante ao criar a conta, em vez de descarta-lo", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=" + destino);
    render(<SignupForm />);

    submitSignup();

    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith(paraOnboarding),
    );
    // E tambem dentro do e-mail de confirmacao: quem confirma no celular nao
    // tem nada da aba original, entao o endereco viaja no proprio link.
    expect(mocks.signUpWithEmail).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      paraOnboarding,
    );
  });

  it("ignora destino de outro dominio (nao vira redirecionamento aberto)", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=https://outro.com/pego");
    render(<SignupForm />);

    submitSignup();

    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith("/welcome?path=student"),
    );
  });

  it("nao perde o destino quando a pessoa troca aprender por ensinar", () => {
    mocks.searchParams = new URLSearchParams("returnTo=" + destino);
    render(<SignupForm />);

    fireEvent.click(screen.getByRole("radio", { name: "auth.signup.roleTeach" }));

    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/auth?mode=signup&path=teacher&returnTo=%2Fcourses%2Ffocus",
      { scroll: false },
    );
  });

  it("carrega o destino pela volta do Google tambem", () => {
    mocks.searchParams = new URLSearchParams("returnTo=" + destino);
    render(<SignupForm />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: /auth\.continueWithGoogle/ }),
    );

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "/loading?next=welcome&path=student&returnTo=%2Fcourses%2Ffocus",
    );
  });
});
