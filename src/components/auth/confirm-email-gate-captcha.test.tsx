import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmEmailGate } from "@/components/auth/confirm-email-gate";

const mocks = vi.hoisted(() => ({
  resendSignupConfirmation: vi.fn(),
  resetSignals: [] as number[],
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  resendSignupConfirmation: mocks.resendSignupConfirmation,
}));

// Turnstile with the site key SET: hands over a token on mount and a fresh one
// after every reset, like the real widget once the challenge auto-solves.
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    isCaptchaEnabled: true,
    TurnstileWidget: ({
      onToken,
      resetSignal = 0,
    }: {
      onToken: (token: string) => void;
      resetSignal?: number;
    }) => {
      useEffect(() => {
        mocks.resetSignals.push(resetSignal);
        onToken(`cf-${resetSignal}`);
      }, [onToken, resetSignal]);
      return null;
    },
  };
});

// The sign-up form's token is spent creating the account, so the resend on
// this gate needs a token of its own or CAPTCHA protection refuses it.
describe("ConfirmEmailGate with CAPTCHA protection on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSignals = [];
    mocks.resendSignupConfirmation.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("resends the confirmation with the captcha token, then asks for a fresh one", async () => {
    render(<ConfirmEmailGate email="learner@example.com" />);

    fireEvent.click(screen.getByRole("button", { name: "auth.signup.confirmResend" }));

    await waitFor(() =>
      expect(mocks.resendSignupConfirmation).toHaveBeenCalledWith(
        "learner@example.com",
        "/loading?next=welcome",
        "cf-0",
      ),
    );
    await waitFor(() => expect(mocks.resetSignals).toContain(1));
  });
});
