import { fireEvent, render, screen } from "@testing-library/react";
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

  // Worse than the reset page: the shared message paragraph renders after the
  // card grid AND after the two-factor card, so below `lg` the answer lands a
  // full screen away from the button that produced it.
  it("scrolls the shared feedback line into view after sending a reset link", async () => {
    mockedResetPassword.mockResolvedValue(undefined);
    render(<SecuritySettingsPanel />);

    clickSendResetLink();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Reset link sent to learner@example.com");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("re-reveals the same confirmation on a repeat press", async () => {
    mockedResetPassword.mockResolvedValue(undefined);
    render(<SecuritySettingsPanel />);

    clickSendResetLink();
    await screen.findByRole("status");

    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    clickSendResetLink();
    await screen.findByRole("status");

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
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
