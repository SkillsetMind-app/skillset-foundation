import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecuritySettingsPanel } from "@/components/account/security-settings-panel";
import { TotpMfaSection } from "@/components/account/totp-mfa-section";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  user: { email: "learner$&@example.test", emailVerified: true },
  mfaEnabled: false,
  captchaReady: true,
  resetSignals: [] as number[],
  calls: {
    sendSkillsetEmailVerification: vi.fn(),
    refreshCurrentUserEmailVerification: vi.fn(),
    requestSkillsetEmailChange: vi.fn(),
    changeSkillsetPassword: vi.fn(),
    resetPassword: vi.fn(),
    listEnrolledTotpFactors: vi.fn(),
    startTotpEnrollment: vi.fn(),
    finishTotpEnrollment: vi.fn(),
    unenrollTotpFactor: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/feature-flags", () => ({ isPublicFeatureEnabled: () => mocks.mfaEnabled }));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  ...mocks.calls,
}));
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    isCaptchaEnabled: true,
    TurnstileWidget: ({ onToken, resetSignal = 0 }: {
      onToken: (token: string) => void;
      resetSignal?: number;
    }) => {
      useEffect(() => {
        mocks.resetSignals.push(resetSignal);
        onToken(mocks.captchaReady ? `test-captcha-${resetSignal}` : "");
      }, [onToken, resetSignal]);
      return <button onClick={() => onToken("test-captcha-solved")}>Solve CAPTCHA</button>;
    },
  };
});

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}

// Deliberately use shipped dictionaries, not the handoff map or a mocked t.
// These regressions stay red until accountSecurity is integrated by the parent.
function renderSpanish(children: React.ReactNode = <SecuritySettingsPanel />) {
  return render(<I18nProvider initialLocale="es"><ChangeLanguage />{children}</I18nProvider>);
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function fillPasswords() {
  fireEvent.change(screen.getByLabelText("Contraseña actual"), { target: { value: "OldPassword42!" } });
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: "NewPassword42!" } });
}

describe("security settings localization with real dictionaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const call of Object.values(mocks.calls)) call.mockReset();
    mocks.user = { email: "learner$&@example.test", emailVerified: true };
    mocks.mfaEnabled = false;
    mocks.captchaReady = true;
    mocks.resetSignals = [];
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([]);
    mocks.calls.refreshCurrentUserEmailVerification.mockResolvedValue(true);
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it("translates labels, placeholders and the checklist without changing entered credentials", () => {
    renderSpanish();
    expect(screen.getByRole("heading", { name: "Protección de la cuenta" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("nuevo-correo@ejemplo.com")).toHaveAccessibleName("Nueva dirección de correo electrónico");
    expect(screen.getByText(/Correo actual:/)).toHaveTextContent(mocks.user.email);
    expect(screen.getByText("Verificado")).toBeInTheDocument();
    expect(screen.getByText(/La autenticación de dos factores aún no está habilitada/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nueva dirección de correo electrónico"), { target: { value: "New$&@example.test" } });
    fillPasswords();
    expect(screen.getByText("Tu contraseña debe incluir:")).toBeInTheDocument();
    expect(screen.getByText("Al menos 8 caracteres")).toBeInTheDocument();

    click("Change language");
    expect(screen.getByRole("heading", { name: "Account protection" })).toBeInTheDocument();
    expect(screen.getByLabelText("New email address")).toHaveValue("New$&@example.test");
    expect(screen.getByPlaceholderText("Current password")).toHaveValue("OldPassword42!");
    expect(screen.getByPlaceholderText("New password")).toHaveValue("NewPassword42!");
    expect(mocks.calls.changeSkillsetPassword).not.toHaveBeenCalled();
    expect(mocks.calls.listEnrolledTotpFactors).not.toHaveBeenCalled();
  });

  it.each([false, true])("translates reset feedback without resending (limited: %s)", async (limited) => {
    if (limited) mocks.calls.resetPassword.mockRejectedValue({ code: "over_email_send_rate_limit" });
    renderSpanish();
    click("Enviarme un enlace de restablecimiento");
    expect(await screen.findByRole("status")).toHaveTextContent(limited ? "Ya enviamos un enlace" : "Enlace de restablecimiento enviado");
    expect(screen.getByRole("status")).toHaveTextContent(mocks.user.email);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    click("Change language");
    expect(screen.getByRole("status")).toHaveTextContent(limited ? "We already sent a reset link" : "Reset link sent to");
    expect(screen.getByRole("status")).toHaveTextContent(mocks.user.email);
    expect(mocks.calls.resetPassword).toHaveBeenCalledExactlyOnceWith(mocks.user.email, "test-captcha-0");
    await waitFor(() => expect(mocks.resetSignals).toContain(1));
  });

  it("keeps both password actions gated by CAPTCHA and preserves the token/reset contract", async () => {
    mocks.captchaReady = false;
    renderSpanish();
    fillPasswords();
    expect(screen.getByRole("button", { name: "Actualizar contraseña" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviarme un enlace de restablecimiento" })).toBeDisabled();
    click("Solve CAPTCHA");
    click("Actualizar contraseña");
    expect(await screen.findByRole("status")).toHaveTextContent("Contraseña actualizada.");
    expect(mocks.calls.changeSkillsetPassword).toHaveBeenCalledExactlyOnceWith("OldPassword42!", "NewPassword42!", "test-captcha-solved");
    expect(screen.getByLabelText("Contraseña actual")).toHaveValue("");
    expect(screen.getByLabelText("Nueva contraseña")).toHaveValue("");
    await waitFor(() => expect(mocks.resetSignals).toContain(1));
    click("Change language");
    expect(screen.getByRole("status")).toHaveTextContent("Password updated.");
    expect(screen.getByRole("button", { name: "Email me a reset link" })).toBeDisabled();
  });

  it.each([
    [{ code: "auth/multi-factor-auth-required" }, "Esta cuenta tiene activada la verificación en dos pasos.", "Two-step verification is on"],
    [{ code: "invalid_credentials", message: "Private provider detail" }, "Correo electrónico o contraseña incorrectos.", "Incorrect email or password."],
    [new Error("Private provider detail"), "Algo salió mal. Inténtalo de nuevo.", "Something went wrong. Please try again."],
  ])("translates password failures without leaking provider copy or retrying: %j", async (failure, spanish, english) => {
    mocks.calls.changeSkillsetPassword.mockRejectedValue(failure);
    renderSpanish();
    fillPasswords();
    click("Actualizar contraseña");
    expect(await screen.findByRole("alert")).toHaveTextContent(spanish);
    expect(screen.queryByText("Private provider detail")).toBeNull();
    click("Change language");
    expect(screen.getByRole("alert")).toHaveTextContent(english);
    expect(screen.getByLabelText("Current password")).toHaveValue("OldPassword42!");
    expect(screen.getByLabelText("New password")).toHaveValue("NewPassword42!");
    expect(mocks.calls.changeSkillsetPassword).toHaveBeenCalledTimes(1);
    expect(mocks.calls.resetPassword).not.toHaveBeenCalled();
  });

  it("preserves the new email payload and translates its success after clearing the field", async () => {
    renderSpanish();
    fireEvent.change(screen.getByLabelText("Nueva dirección de correo electrónico"), { target: { value: "New$&@example.test" } });
    click("Enviar confirmación del cambio");
    expect(await screen.findByRole("status")).toHaveTextContent("Enviamos un mensaje de verificación al nuevo correo.");
    expect(mocks.calls.requestSkillsetEmailChange).toHaveBeenCalledExactlyOnceWith("New$&@example.test");
    expect(screen.getByLabelText("Nueva dirección de correo electrónico")).toHaveValue("");
    click("Change language");
    expect(screen.getByRole("status")).toHaveTextContent("Verification sent to the new email.");
  });

  it.each(["email", "reset"])("uses safe translated fallback for unknown %s failures", async (action) => {
    mocks.calls.requestSkillsetEmailChange.mockRejectedValue(new Error("Private provider detail"));
    mocks.calls.resetPassword.mockRejectedValue(new Error("Private provider detail"));
    renderSpanish();
    if (action === "email") {
      fireEvent.change(screen.getByLabelText("Nueva dirección de correo electrónico"), { target: { value: "new@example.test" } });
      click("Enviar confirmación del cambio");
    } else click("Enviarme un enlace de restablecimiento");
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal. Inténtalo de nuevo.");
    expect(screen.queryByText("Private provider detail")).toBeNull();
    click("Change language");
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it.each([
    ["sendSkillsetEmailVerification", "Enviar correo", "Correo de verificación enviado.", "Verification email sent."],
    ["refreshCurrentUserEmailVerification", "Actualizar estado", "Correo verificado.", "Email verified."],
  ] as const)("translates verification success and failure: %s", async (method, button, spanish, english) => {
    mocks.user.emailVerified = false;
    renderSpanish();
    expect(screen.getByText("Obligatoria")).toBeInTheDocument();
    mocks.calls[method].mockRejectedValueOnce(new Error("Private provider detail"));
    click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(method === "sendSkillsetEmailVerification" ? "No se pudo enviar el correo" : "No se pudo actualizar el estado");
    click("Change language");
    expect(screen.getByRole("alert")).toHaveTextContent(method === "sendSkillsetEmailVerification" ? "Could not send the verification email" : "Could not refresh your email verification status");
    click("Change language");
    click(button);
    expect(await screen.findByRole("status")).toHaveTextContent(spanish);
    click("Change language");
    expect(screen.getByRole("status")).toHaveTextContent(english);
    expect(mocks.calls[method]).toHaveBeenCalledTimes(2);
  });

  it("localizes an unverified refresh and keeps MFA enrollment gated", async () => {
    mocks.user.emailVerified = false;
    mocks.mfaEnabled = true;
    mocks.calls.refreshCurrentUserEmailVerification.mockResolvedValue(false);
    renderSpanish();
    expect(screen.getByText("Verifica tu correo arriba antes de activar la autenticación de dos factores.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configurar autenticador" })).toBeNull();
    click("Actualizar estado");
    expect(await screen.findByRole("status")).toHaveTextContent("El correo aún no está verificado.");
    click("Change language");
    expect(screen.getByRole("status")).toHaveTextContent("Email is not verified yet.");
    expect(mocks.calls.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("localizes the missing-email guard without sending a reset", () => {
    mocks.user.email = "";
    renderSpanish();
    expect(screen.getByText(/Correo actual:/)).toHaveTextContent("No hay correo registrado");
    click("Enviarme un enlace de restablecimiento");
    expect(screen.getByRole("alert")).toHaveTextContent("Esta cuenta accede con Google");
    click("Change language");
    expect(screen.getByRole("alert")).toHaveTextContent("This account signs in with Google");
    expect(mocks.calls.resetPassword).not.toHaveBeenCalled();
  });

  it("localizes MFA setup, retains code/errors across languages and preserves the persisted friendly name", async () => {
    mocks.mfaEnabled = true;
    const setup = { secret: { factorId: "test-factor" }, secretKey: "test-setup-key", otpauthUrl: "otpauth://totp/test-only" };
    mocks.calls.startTotpEnrollment.mockResolvedValue(setup);
    mocks.calls.finishTotpEnrollment.mockRejectedValueOnce({ code: "invalid_otp", message: "Private provider detail" });
    renderSpanish(<TotpMfaSection emailVerified />);
    click("Configurar autenticador");
    const code = await screen.findByLabelText("Código de autenticación");
    expect(code).toHaveAttribute("placeholder", "000000");
    expect(screen.getByText("Clave de configuración")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "abre este enlace de configuración" })).toHaveAttribute("href", setup.otpauthUrl);
    expect(screen.getByText(setup.secretKey)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar 2FA" })).toBeDisabled();
    fireEvent.change(code, { target: { value: "12a34567" } });
    expect(code).toHaveValue("123456");
    click("Activar 2FA");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ese código no coincide.");
    expect(screen.queryByText("Private provider detail")).toBeNull();
    click("Change language");
    expect(screen.getByLabelText("Authenticator code")).toHaveValue("123456");
    expect(screen.getByRole("alert")).toHaveTextContent("That code didn't match.");
    expect(mocks.calls.startTotpEnrollment).toHaveBeenCalledTimes(1);
    expect(mocks.calls.listEnrolledTotpFactors).toHaveBeenCalledTimes(1);
    expect(mocks.calls.finishTotpEnrollment).toHaveBeenCalledExactlyOnceWith(setup.secret, "123456", "Authenticator app");
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([{ uid: "test-factor", displayName: "Authenticator app", enrolledAt: null }]);
    let finish!: () => void;
    mocks.calls.finishTotpEnrollment.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    click("Turn on 2FA");
    expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
    click("Change language");
    expect(screen.getByRole("button", { name: "Verificando..." })).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByText("La autenticación de dos factores está activada. Tu cuenta está protegida.")).toBeInTheDocument();
    expect(screen.getByText("Aplicación de autenticación")).toBeInTheDocument();
    expect(mocks.calls.finishTotpEnrollment).toHaveBeenLastCalledWith(setup.secret, "123456", "Authenticator app");
  });

  it("translates pending setup and clipboard feedback and cancels without enrolling", async () => {
    mocks.mfaEnabled = true;
    const setup = { secret: { factorId: "test-factor" }, secretKey: "test-setup-key", otpauthUrl: "otpauth://totp/test-only" };
    let prepare!: (value: typeof setup) => void;
    mocks.calls.startTotpEnrollment.mockReturnValueOnce(new Promise<typeof setup>((resolve) => { prepare = resolve; }));
    renderSpanish(<TotpMfaSection emailVerified />);
    click("Configurar autenticador");
    expect(screen.getByRole("button", { name: "Preparando..." })).toBeDisabled();
    click("Change language");
    expect(screen.getByRole("button", { name: "Preparing..." })).toBeDisabled();
    await act(async () => prepare(setup));

    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.useFakeTimers();
    try {
      await act(async () => click("Copy"));
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      click("Change language");
      expect(screen.getByRole("button", { name: "Copiada" })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledExactlyOnceWith(setup.secretKey);
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Código de autenticación"), { target: { value: "123456" } });
      click("Cancelar");
      expect(screen.queryByLabelText("Código de autenticación")).toBeNull();
      expect(screen.getByRole("button", { name: "Configurar autenticador" })).toBeInTheDocument();
      expect(mocks.calls.startTotpEnrollment).toHaveBeenCalledTimes(1);
      expect(mocks.calls.finishTotpEnrollment).not.toHaveBeenCalled();
      expect(mocks.calls.unenrollTotpFactor).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("localizes MFA dates and confirmation while preserving custom names and the factor id", async () => {
    mocks.mfaEnabled = true;
    const enrolledAt = "2026-09-10T12:00:00Z";
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([{ uid: "test-factor", displayName: "My original device", enrolledAt }]);
    renderSpanish(<TotpMfaSection emailVerified />);
    expect(await screen.findByText("My original device")).toBeInTheDocument();
    expect(screen.getByText(`Registrada el ${new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(enrolledAt))}`)).toBeInTheDocument();
    click("Desactivar");
    expect(screen.getByText("¿Desactivar la autenticación de dos factores?")).toBeInTheDocument();
    expect(mocks.calls.unenrollTotpFactor).not.toHaveBeenCalled();
    click("Change language");
    expect(screen.getByText(`Enrolled ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(enrolledAt))}`)).toBeInTheDocument();
    expect(screen.getByText("My original device")).toBeInTheDocument();
    expect(mocks.calls.listEnrolledTotpFactors).toHaveBeenCalledTimes(1);
    click("Keep it on");
    expect(mocks.calls.unenrollTotpFactor).not.toHaveBeenCalled();
    click("Turn off");
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([]);
    click("Yes, turn off");
    expect(await screen.findByText("Two-factor authentication turned off.")).toBeInTheDocument();
    expect(mocks.calls.unenrollTotpFactor).toHaveBeenCalledExactlyOnceWith("test-factor");
    click("Change language");
    expect(screen.getByText("Autenticación de dos factores desactivada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configurar autenticador" })).toBeInTheDocument();
  });

  it.each(["start", "disable"])("keeps unknown MFA %s errors behind translated fallback", async (action) => {
    mocks.mfaEnabled = true;
    if (action === "disable") {
      mocks.calls.listEnrolledTotpFactors.mockResolvedValue([{ uid: "test-factor", displayName: "", enrolledAt: null }]);
      mocks.calls.unenrollTotpFactor.mockRejectedValue(new Error("Private provider detail"));
    } else mocks.calls.startTotpEnrollment.mockRejectedValue(new Error("Private provider detail"));
    renderSpanish(<TotpMfaSection emailVerified />);
    if (action === "disable") {
      await screen.findByText("Aplicación de autenticación");
      click("Desactivar");
      click("Sí, desactivar");
    } else click("Configurar autenticador");
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal. Inténtalo de nuevo.");
    expect(screen.queryByText("Private provider detail")).toBeNull();
    click("Change language");
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(action === "disable" ? mocks.calls.unenrollTotpFactor : mocks.calls.startTotpEnrollment).toHaveBeenCalledTimes(1);
  });
});
