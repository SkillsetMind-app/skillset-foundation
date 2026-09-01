import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecuritySettingsPanel } from "@/components/account/security-settings-panel";

const mocks = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    calls: { changeSkillsetPassword: fn(), resetPassword: fn() },
    resetSignals: [] as number[],
  };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: { email: "learner@example.com", emailVerified: true },
  }),
}));

vi.mock("@/components/account/totp-mfa-section", () => ({
  TotpMfaSection: () => null,
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  ...mocks.calls,
}));

// Stands in for Turnstile with the site key SET: hands over a token as soon as
// it mounts and a fresh one after every reset, like the real widget once the
// challenge auto-solves. Records each resetSignal it was rendered with.
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

const strongNext = "Skillset2026!";

function clickResetLink() {
  fireEvent.click(screen.getByRole("button", { name: "Email me a reset link" }));
}

// The reported bug: neither password action on this panel carried a captcha
// token, so with Attack Protection on both dead-ended on "captcha protection:
// request disallowed" — and the panel had no widget to solve it with.
describe("SecuritySettingsPanel with CAPTCHA protection on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSignals = [];
    Element.prototype.scrollIntoView = vi.fn();
    mocks.calls.changeSkillsetPassword.mockResolvedValue(undefined);
    mocks.calls.resetPassword.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("re-authenticates the password change with the captcha token", async () => {
    render(<SecuritySettingsPanel />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "OldPass1!" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: strongNext },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await screen.findByRole("status");
    expect(mocks.calls.changeSkillsetPassword).toHaveBeenCalledWith(
      "OldPass1!",
      strongNext,
      "cf-0",
    );
  });

  it("sends the reset link with the captcha token too", async () => {
    render(<SecuritySettingsPanel />);

    clickResetLink();

    await screen.findByRole("status");
    expect(mocks.calls.resetPassword).toHaveBeenCalledWith(
      "learner@example.com",
      "cf-0",
    );
  });

  // Turnstile tokens are consumed once. Without the refresh, the second
  // attempt on this screen would be refused with the first attempt's token.
  it("asks the widget for a fresh token after an attempt", async () => {
    render(<SecuritySettingsPanel />);

    clickResetLink();
    await screen.findByRole("status");

    await waitFor(() => expect(mocks.resetSignals).toContain(1));
  });
});
