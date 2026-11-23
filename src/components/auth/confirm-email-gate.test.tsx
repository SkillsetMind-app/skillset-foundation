import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmEmailGate, ExpiredConfirmationLink } from "@/components/auth/confirm-email-gate";
import { getAuthErrorMessage } from "@/lib/auth/supabase-auth";

/**
 * Quem confirma o e-mail em outra aba (o link abre ao lado) deixava a aba do
 * cadastro parada para sempre em "confirme seu e-mail". A porta agora olha de
 * novo, sozinha, de tempos em tempos e quando a aba volta ao foco.
 */

const mocks = vi.hoisted(() => ({
  refreshCurrentUserEmailVerification: vi.fn(),
  resendSignupConfirmation: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  refreshCurrentUserEmailVerification: mocks.refreshCurrentUserEmailVerification,
  resendSignupConfirmation: mocks.resendSignupConfirmation,
}));

vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("location", { ...window.location, assign: mocks.assign });
  mocks.refreshCurrentUserEmailVerification.mockResolvedValue(false);
  mocks.resendSignupConfirmation.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("ConfirmEmailGate notices a confirmation made elsewhere", () => {
  it("re-checks every few seconds and continues once the email is confirmed", async () => {
    render(<ConfirmEmailGate email="learner@example.com" intent="teacher" returnTo="/courses/focus" />);

    await tick(6000);
    expect(mocks.refreshCurrentUserEmailVerification).toHaveBeenCalledTimes(1);
    // Only THIS account counts: another one signed in elsewhere must not
    // pull this tab into it.
    expect(mocks.refreshCurrentUserEmailVerification).toHaveBeenCalledWith("learner@example.com");
    expect(mocks.assign).not.toHaveBeenCalled();

    mocks.refreshCurrentUserEmailVerification.mockResolvedValue(true);
    await tick(6000);

    expect(mocks.assign).toHaveBeenCalledTimes(1);
    expect(mocks.assign).toHaveBeenCalledWith(
      "/loading?next=welcome&path=teacher&returnTo=%2Fcourses%2Ffocus",
    );

    // Done: no more checks after continuing.
    await tick(30000);
    expect(mocks.refreshCurrentUserEmailVerification).toHaveBeenCalledTimes(2);
  });

  it("re-checks right away when the tab regains focus", async () => {
    mocks.refreshCurrentUserEmailVerification.mockResolvedValue(true);
    render(<ConfirmEmailGate email="learner@example.com" />);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocks.assign).toHaveBeenCalledWith("/loading?next=welcome");
  });

  it("does not poll while the tab is hidden", async () => {
    visibility = "hidden";
    render(<ConfirmEmailGate email="learner@example.com" />);

    await tick(60000);
    expect(mocks.refreshCurrentUserEmailVerification).not.toHaveBeenCalled();

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.refreshCurrentUserEmailVerification).toHaveBeenCalledTimes(1);
  });

  it("stops polling once unmounted", async () => {
    const view = render(<ConfirmEmailGate email="learner@example.com" />);
    view.unmount();

    await tick(60000);
    window.dispatchEvent(new Event("focus"));
    expect(mocks.refreshCurrentUserEmailVerification).not.toHaveBeenCalled();
  });

  it("keeps waiting when a check fails (offline), instead of breaking the screen", async () => {
    mocks.refreshCurrentUserEmailVerification.mockRejectedValueOnce(new Error("offline"));
    render(<ConfirmEmailGate email="learner@example.com" />);

    await tick(6000);
    mocks.refreshCurrentUserEmailVerification.mockResolvedValue(true);
    await tick(6000);

    expect(mocks.assign).toHaveBeenCalledWith("/loading?next=welcome");
  });
});

// O leitor de tela lia "Resend in 59s... 58s..." a cada segundo. O numero fica
// so no botao (fora de regiao viva) e a espera e anunciada duas vezes: enviado,
// e depois "ja pode pedir outro", na mesma linha de status.
describe("ConfirmEmailGate resend countdown for screen readers", () => {
  it("keeps the ticking number out of live regions and announces once when resend is back", async () => {
    render(<ConfirmEmailGate email="learner@example.com" />);

    // A regiao ja existe, vazia, antes do primeiro envio: regiao que nasce
    // cheia costuma nao ser lida.
    const status = screen.getAllByRole("status").find((element) => element.textContent === "");
    expect(status).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmResend" }));
    });
    // O texto entra no MESMO elemento.
    expect(screen.getByText("auth.signup.confirmResent")).toBe(status);
    expect(status).not.toHaveTextContent("auth.signup.confirmResendReady");
    const countdown = screen.getByRole("button", { name: "auth.signup.confirmResendIn" });
    expect(countdown).toBeDisabled();
    expect(countdown.closest("[role='status'], [aria-live]")).toBeNull();

    // A espera de 60 s continua a mesma.
    for (let second = 0; second < 59; second += 1) await tick(1000);
    expect(status).not.toHaveTextContent("auth.signup.confirmResendReady");
    await tick(1000);

    expect(status).toHaveTextContent("auth.signup.confirmResendReady");
    expect(screen.getByRole("button", { name: "auth.signup.confirmResend" })).toBeEnabled();
    expect(mocks.resendSignupConfirmation).toHaveBeenCalledTimes(1);
  });
});

// F-07: a falha do reenvio era uma frase vermelha solta; agora é o aviso da
// casa (caixa e ícone), com a mesma frase e o mesmo anúncio, uma vez só.
// I-2: a espera desenha o anel da casa, nos mesmos 16px.
describe("ConfirmEmailGate: o aviso e o anel da casa", () => {
  const offline = new Error("Failed to fetch");
  const message = getAuthErrorMessage(offline, (key) => key);

  it("a falha do reenvio aparece no aviso da casa, com role=alert e a mesma frase", async () => {
    mocks.resendSignupConfirmation.mockRejectedValue(offline);
    render(<ConfirmEmailGate email="learner@example.com" />);
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmResend" }));
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(message);
    expect(alerts[0]).toHaveAttribute("aria-live", "assertive");
    expect(alerts[0].querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("no link vencido, a falha do envio também vira o aviso da casa", async () => {
    mocks.resendSignupConfirmation.mockRejectedValue(offline);
    render(<ExpiredConfirmationLink onSignIn={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "learner@example.com" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "auth.signup.expiredSend" }));
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(message);
    expect(alerts[0].querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("a espera usa o anel da casa, escondido do leitor, com 16px e giro só com movimento", () => {
    render(<ConfirmEmailGate email="learner@example.com" />);
    const waiting = screen.getByText("auth.signup.confirmWaiting");
    const ring = waiting.querySelector("span[aria-hidden='true']");
    expect(ring).not.toBeNull();
    expect(ring).toHaveClass(
      "rounded-full",
      "border-[var(--color-line)]",
      "border-t-[var(--color-accent-fg)]",
      "motion-safe:animate-spin",
      "size-4!",
      "shrink-0",
    );
    expect(waiting).toHaveAttribute("role", "status");
  });
});
