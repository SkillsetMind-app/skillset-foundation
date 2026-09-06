import {
  act,
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
  googleEnabled: true,
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

vi.mock("@/lib/auth/providers", () => ({
  get isGoogleAuthEnabled() { return mocks.googleEnabled; },
}));

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

describe("SignupForm presents only the available paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
  });
  afterEach(() => {
    cleanup();
    mocks.googleEnabled = true;
    mocks.searchParams = new URLSearchParams();
  });

  it.each([false, true])("shows the alternative separator only when Google is configured: %s", (enabled) => {
    mocks.googleEnabled = enabled;
    render(<SignupForm />);
    expect(Boolean(screen.queryByText("auth.signup.or"))).toBe(enabled);
    expect(Boolean(screen.queryByRole("button", { name: /auth.continueWithGoogle/ }))).toBe(enabled);
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
  });

  it("announces both signup steps and keeps identity, terms and intent when returning", () => {
    render(<SignupForm />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "2");
    fireEvent.change(screen.getByLabelText("auth.signup.fullName"), { target: { value: "Alex Rivera" } });
    fireEvent.change(screen.getByLabelText("auth.email"), { target: { value: "alex@example.test" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "auth.signup.continue" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByLabelText("auth.password")).toHaveFocus();
    expect(mocks.signUpWithEmail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "auth.signup.back" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByLabelText("auth.signup.fullName")).toHaveValue("Alex Rivera");
    expect(screen.getByLabelText("auth.email")).toHaveValue("alex@example.test");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("radio", { name: "auth.signup.roleTeach" })).toHaveAttribute("aria-checked", "true");
    expect(mocks.signUpWithEmail).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps native Back non-submitting across the step change with a password draft: %s", async (hasPasswordDraft) => {
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("auth.signup.fullName"), { target: { value: "Alex Rivera" } });
    fireEvent.change(screen.getByLabelText("auth.email"), { target: { value: "alex@example.test" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "auth.signup.continue" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    if (hasPasswordDraft) {
      fireEvent.change(screen.getByLabelText("auth.password"), { target: { value: strongSecret } });
      fireEvent.change(screen.getByLabelText("auth.signup.confirmPassword"), { target: { value: strongSecret } });
    }

    const back = screen.getByRole<HTMLButtonElement>("button", { name: "auth.signup.back" });
    await act(async () => { back.click(); });

    // Native activation can run after React updates the step. Its original
    // click target must not become the new Continue submit button.
    expect(back).toHaveAttribute("type", "button");
    expect(back).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByLabelText("auth.signup.fullName")).toHaveValue("Alex Rivera");
    expect(screen.getByLabelText("auth.email")).toHaveValue("alex@example.test");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("radio", { name: "auth.signup.roleTeach" })).toHaveAttribute("aria-checked", "true");
    expect(mocks.signUpWithEmail).not.toHaveBeenCalled();
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "auth.signup.continue" }));
    expect(screen.getByPlaceholderText("auth.signup.passwordPlaceholder")).toHaveValue(hasPasswordDraft ? strongSecret : "");
    expect(screen.getByPlaceholderText("auth.signup.confirmPasswordPlaceholder")).toHaveValue(hasPasswordDraft ? strongSecret : "");
    expect(mocks.signUpWithEmail).not.toHaveBeenCalled();
  });
});

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

  it.each([
    ["/courses/focus/checkout?offer=LAUNCH&priceId=price-1", "/courses/focus/checkout?offer=LAUNCH&priceId=price-1"],
    ["//outside.example/checkout", null],
    ["/loading?next=route", null],
  ])("preserves only the safe checkout destination in the sign-in link: %s", (returnTo, expected) => {
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: returnTo!, external: "discard" });
    render(<SignupForm />);
    const destination = new URL(screen.getByRole("link", { name: "auth.signup.alreadyHaveAccount" }).getAttribute("href")!, "https://skillset.test");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("mode")).toBe("signin");
    expect(destination.searchParams.get("path")).toBe("student");
    expect(destination.searchParams.get("returnTo")).toBe(expected);
    expect(destination.searchParams.has("external")).toBe(false);
    expect(mocks.signUpWithEmail).not.toHaveBeenCalled();
  });

  it("keeps the selected checkout offer when an existing account chooses sign-in", async () => {
    const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: checkout });
    mocks.signUpWithEmail.mockRejectedValueOnce({ code: "user_already_exists", status: 422 });
    render(<SignupForm />);
    submitSignup();
    const signin = await screen.findByRole("link", { name: "auth.signup.existingAccountSignIn" });
    expect(new URL(signin.getAttribute("href")!, "https://skillset.test").searchParams.get("returnTo")).toBe(checkout);
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
  });
});
