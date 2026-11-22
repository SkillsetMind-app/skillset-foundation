import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SecuritySettingsPanel } from "@/components/account/security-settings-panel";
import { resetPassword } from "@/lib/auth/supabase-auth";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: { email: "learner@example.com", emailVerified: true },
  }),
}));

// The 2FA card is the block that sits between the button and the answer on
// mobile — irrelevant to what is asserted here, and it owns its own network
// calls, so stub it out.
vi.mock("@/components/account/totp-mfa-section", () => ({
  TotpMfaSection: () => null,
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  resetPassword: vi.fn(),
}));

const mockedResetPassword = vi.mocked(resetPassword);

function clickSendResetLink() {
  fireEvent.click(screen.getByRole("button", { name: "Email me a reset link" }));
}

describe("SecuritySettingsPanel feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  // A resposta aparecia depois da grade inteira E do cartão de dois fatores
  // (abaixo do `lg`, uma tela longe do botão) e a página rolava até ela.
  // Agora ela nasce logo abaixo do botão que a pediu, sem rolar nada.
  it("mostra a confirmação do link logo abaixo do botão, sem rolar a página", async () => {
    mockedResetPassword.mockResolvedValue(undefined);
    render(<SecuritySettingsPanel />);

    clickSendResetLink();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Reset link sent to learner@example.com");
    expect(status.previousElementSibling).toBe(
      screen.getByRole("button", { name: "Email me a reset link" }),
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("re-shows the same confirmation on a repeat press", async () => {
    mockedResetPassword.mockResolvedValue(undefined);
    render(<SecuritySettingsPanel />);

    clickSendResetLink();
    await screen.findByRole("status");
    clickSendResetLink();

    expect(await screen.findByRole("status")).toHaveTextContent("Reset link sent to");
    expect(mockedResetPassword).toHaveBeenCalledTimes(2);
  });

  it("troca o texto só do botão apertado enquanto o pedido anda", async () => {
    let finish!: () => void;
    mockedResetPassword.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SecuritySettingsPanel />);

    clickSendResetLink();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();

    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Email me a reset link" })).toBeEnabled();
  });

  it("com o e-mail já verificado não oferece reenviar nem atualizar o status", () => {
    render(<SecuritySettingsPanel />);

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh status" })).toBeNull();
    // Rótulo visível em cada campo, não só o placeholder.
    expect(screen.getByLabelText("Current password")).toHaveClass("field-input");
    expect(screen.getByLabelText("New email address")).toHaveClass("field-input");
  });

  it("treats the email send limit as reassurance, not an error", async () => {
    mockedResetPassword.mockRejectedValue({
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 60s",
      status: 429,
    });
    render(<SecuritySettingsPanel />);

    clickSendResetLink();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("We already sent a reset link");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
