import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "@/components/auth/loading-screen";
import { LoginForm } from "@/components/auth/login-form";
import { AuthPage } from "@/components/auth/auth-page";
import { SignupForm } from "@/components/auth/signup-form";
import { ConfirmEmailGate } from "@/components/auth/confirm-email-gate";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { OnboardingWizard } from "@/components/auth/onboarding-wizard";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams(),
  auth: {
    status: "authenticated",
    user: { uid: "locale-user", displayName: "Alex Rivera", email: "alex@example.test", roles: ["student"] },
  },
  getUserProfile: vi.fn(),
  getPendingSecondFactor: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  resendSignupConfirmation: vi.fn(),
  resetPassword: vi.fn(),
  completePasswordRecovery: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  updateUserIdentity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: false }));
vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signInWithEmail: mocks.signInWithEmail,
  signUpWithEmail: mocks.signUpWithEmail,
  resendSignupConfirmation: mocks.resendSignupConfirmation,
  resetPassword: mocks.resetPassword,
  completePasswordRecovery: mocks.completePasswordRecovery,
  getPendingSecondFactor: mocks.getPendingSecondFactor,
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
  updateUserIdentity: mocks.updateUserIdentity,
  acceptUserTerms: vi.fn(),
}));
vi.mock("@/lib/posthog/events", () => ({ track: { userSignedUp: vi.fn() } }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}

function renderSpanish(children: React.ReactNode) {
  return render(<I18nProvider initialLocale="es"><ChangeLanguage />{children}</I18nProvider>);
}

describe("auth flow follows the selected language without resetting state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mocks.searchParams = new URLSearchParams();
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.getUserProfile.mockResolvedValue({ displayName: "Alex Rivera", phoneNumber: null, onboardingAnswers: {} });
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("changes language from the real auth header without discarding credentials", async () => {
    mocks.searchParams = new URLSearchParams("mode=signin");
    const { container } = render(<I18nProvider initialLocale="en"><AuthPage /></I18nProvider>);
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "unchanged-password" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "es" } });
    expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveValue("es");
    expect(screen.getByDisplayValue("alex@example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("unchanged-password")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1));
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps recovery feedback localized without sending again (rate limit: %s)", async (limited) => {
    if (limited) mocks.resetPassword.mockRejectedValue({ code: "over_email_send_rate_limit" });
    else mocks.resetPassword.mockResolvedValue(undefined);
    const { container } = renderSpanish(<ResetPasswordForm />);
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent(limited ? "Ya enviamos un enlace" : "Si existe una cuenta");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("status")).toHaveTextContent(limited ? "We already sent a reset link" : "If an account exists");
    expect(screen.getByDisplayValue("alex@example.test")).toBeInTheDocument();
    expect(mocks.resetPassword).toHaveBeenCalledTimes(1);
  });

  it("translates an invalid recovery link without exposing the password form", () => {
    const { container } = renderSpanish(<UpdatePasswordForm recoveryVerified={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Este enlace para restablecer la contraseña no es válido");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This password reset link is invalid");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(mocks.completePasswordRecovery).not.toHaveBeenCalled();
  });

  it("keeps a rejected new password and translates its error without resubmitting", async () => {
    mocks.completePasswordRecovery.mockRejectedValue({ code: "same_password" });
    const { container } = renderSpanish(<UpdatePasswordForm recoveryVerified />);
    for (const input of container.querySelectorAll('input[type="password"]')) {
      fireEvent.change(input, { target: { value: "UnchangedPassword42!" } });
    }
    expect(screen.getByText("Tu contraseña debe incluir:")).toBeInTheDocument();
    expect(screen.getByText("Al menos 8 caracteres")).toBeInTheDocument();
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tu nueva contraseña debe ser diferente");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Your new password must be different");
    expect(screen.getAllByDisplayValue("UnchangedPassword42!")).toHaveLength(2);
    expect(mocks.completePasswordRecovery).toHaveBeenCalledTimes(1);
  });

  it("translates callback failures again when switching language and keeps the credentials", async () => {
    mocks.searchParams = new URLSearchParams("error=otp_expired");
    const { container } = renderSpanish(<LoginForm />);
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "unchanged-password" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Este enlace ya se usó o caducó.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));

    expect(screen.getByRole("alert")).toHaveTextContent("That link has already been used or has expired.");
    expect(screen.getByDisplayValue("alex@example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("unchanged-password")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1));
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
  });

  it("localizes known provider error codes at render time without another sign-in", async () => {
    mocks.signInWithEmail.mockRejectedValue({ code: "invalid_credentials", message: "Provider detail stays private" });
    const { container } = renderSpanish(<LoginForm />);
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "unchanged-password" } });
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Correo electrónico o contraseña incorrectos.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(screen.getByDisplayValue("unchanged-password")).toBeInTheDocument();
    expect(mocks.signInWithEmail).toHaveBeenCalledTimes(1);
    expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown provider details behind a safe localized fallback", async () => {
    mocks.signInWithEmail.mockRejectedValue(new Error("Unexpected provider internals"));
    const { container } = renderSpanish(<LoginForm />);
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal. Inténtalo de nuevo.");
    expect(screen.queryByText("Unexpected provider internals")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("translates a signup failure without losing password, identity or the chosen role", async () => {
    mocks.signUpWithEmail.mockRejectedValue({ code: "user_already_exists" });
    const { container } = renderSpanish(<SignupForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Quiero enseñar" }));
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Alex Rivera" } });
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "alex@example.test" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form")!);
    for (const input of container.querySelectorAll('input[type="password"]')) {
      fireEvent.change(input, { target: { value: "UnchangedPassword42!" } });
    }
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una cuenta con este correo electrónico.");

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("An account already exists with this email.");
    expect(screen.getAllByDisplayValue("UnchangedPassword42!")).toHaveLength(2);
    expect(mocks.signUpWithEmail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByDisplayValue("Alex Rivera")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alex@example.test")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "I want to teach" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("updates a signup validation already shown without another submission", async () => {
    const { container } = renderSpanish(<SignupForm />);
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Acepta los Términos del Servicio");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Accept the Terms of Service");
    expect(mocks.signUpWithEmail).not.toHaveBeenCalled();
  });

  it("localizes confirmation resend failures without sending another email", async () => {
    mocks.resendSignupConfirmation.mockRejectedValue({ code: "over_email_send_rate_limit" });
    renderSpanish(<ConfirmEmailGate email="alex@example.test" />);
    fireEvent.click(screen.getByRole("button", { name: "Reenviar el enlace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts.");
    expect(mocks.resendSignupConfirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByText("alex@example.test")).toBeInTheDocument();
  });

  it.each([
    ["student", "/courses/focus/checkout?offer=LAUNCH&priceId=price-1", "/courses/focus/checkout?offer=LAUNCH&priceId=price-1"],
    ["teacher", "/courses/focus/checkout?offer=LAUNCH&priceId=price-1", "/courses/focus/checkout?offer=LAUNCH&priceId=price-1"],
    [null, "/courses/focus/checkout", "/courses/focus/checkout"],
    ["teacher", null, null],
    ["teacher", "/\n/outside.example/checkout", null],
    ["student", "/auth?mode=signup", null],
    [null, null, null],
  ] as const)("preserves only safe confirmation context after a language switch: %s / %s", async (intent, returnTo, expectedReturnTo) => {
    mocks.resendSignupConfirmation.mockResolvedValue(undefined);
    renderSpanish(<ConfirmEmailGate email="alex@example.test" intent={intent} returnTo={returnTo} />);
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    fireEvent.click(screen.getByRole("button", { name: "Resend the link" }));
    expect(await screen.findByText("Sent again. Give it a minute.")).toBeInTheDocument();

    expect(mocks.resendSignupConfirmation).toHaveBeenCalledTimes(1);
    const [email, destination] = mocks.resendSignupConfirmation.mock.calls[0];
    expect(email).toBe("alex@example.test");
    expect(destination).toBeTypeOf("string");
    const next = new URL(destination, "https://skillset.test");
    expect(next.pathname).toBe("/loading");
    expect(next.searchParams.get("next")).toBe("welcome");
    expect(next.searchParams.get("path")).toBe(intent);
    expect(next.searchParams.get("returnTo")).toBe(expectedReturnTo);
    const signin = new URL(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")!, "https://skillset.test");
    expect(signin.searchParams.get("path")).toBe(intent);
    expect(signin.searchParams.get("returnTo")).toBe(expectedReturnTo);
    expect(screen.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled();
  });

  it("translates the sent notice and keeps the resend cooldown after switching language", async () => {
    mocks.resendSignupConfirmation.mockResolvedValue(undefined);
    renderSpanish(<ConfirmEmailGate email="alex@example.test" />);
    fireEvent.click(screen.getByRole("button", { name: "Reenviar el enlace" }));
    expect(await screen.findByText("Enviado de nuevo. Dale un minuto.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("Sent again. Give it a minute.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled();
    expect(mocks.resendSignupConfirmation).toHaveBeenCalledTimes(1);
  });

  it("translates loading and its saved failure without fetching the profile again", async () => {
    mocks.getUserProfile.mockRejectedValue(new Error("Profile unavailable"));
    renderSpanish(<LoadingScreen />);
    expect(await screen.findByRole("heading", { name: "Preparando tu espacio de trabajo" })).toBeInTheDocument();
    expect(await screen.findByText("No se pudo cargar tu espacio de trabajo. Actualiza la página para intentarlo de nuevo.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("heading", { name: "Preparing your workspace" })).toBeInTheDocument();
    expect(screen.getByText("Could not load your workspace. Refresh the page to try again.")).toBeInTheDocument();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("translates onboarding, progress and validation while preserving edited identity", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    renderSpanish(<OnboardingWizard />);
    expect(await screen.findByRole("heading", { name: "Primero, cuéntanos quién eres." })).toBeInTheDocument();
    expect(screen.getByText("Pregunta 01")).toBeInTheDocument();
    expect(screen.getByLabelText("Pregunta 1 de 7")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Alex Edited" } });
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("Introduce un teléfono con código de área, como +1 555 123 4567.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("Alex Edited");
    expect(screen.getByLabelText("Phone")).toHaveValue("12");
    expect(screen.getByText("Enter a phone number with area code, like +1 555 123 4567.")).toBeInTheDocument();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
  });

  it("translates category labels but persists the original values across a language switch", async () => {
    mocks.getUserProfile.mockResolvedValue({
      displayName: "Alex Rivera",
      onboardingAnswers: { profileConfirmed: true, path: "teacher", profession: "Coach" },
    });
    renderSpanish(<OnboardingWizard />);
    expect(await screen.findByRole("heading", { name: "¿Qué tipo de programa publicarás?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coaching como negocio" }));
    await waitFor(() => expect(mocks.updateOnboardingAnswers).toHaveBeenLastCalledWith(expect.objectContaining({
      answers: expect.objectContaining({ primaryGoal: ["Coaching as a Business"] }),
    })));

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    fireEvent.click(screen.getByRole("button", { name: "Personal Development" }));
    await waitFor(() => expect(mocks.updateOnboardingAnswers).toHaveBeenLastCalledWith(expect.objectContaining({
      answers: expect.objectContaining({ primaryGoal: ["Coaching as a Business", "Personal Development"] }),
    })));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledTimes(2);
  });
});
