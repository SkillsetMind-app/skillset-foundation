import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

  // The response appeared after the whole grid AND the two-factor card
  // (below `lg`, a screen away from the button) and the page scrolled to it.
  // Now it appears right below the button that asked for it, with no scrolling.
  it("shows the link confirmation right below the button, without scrolling the page", async () => {
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

  it("changes the text only of the pressed button while the request is in flight", async () => {
    let finish!: () => void;
    mockedResetPassword.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SecuritySettingsPanel />);
    // The two labels in the same cell: the waiting one hidden and out of the name.
    // The hover underline lives on the pair itself (the button's does not cross the
    // inline-grid).
    const reset = screen.getByRole("button", { name: "Email me a reset link" });
    expect(within(reset).getByText("Sending...")).toHaveAttribute("aria-hidden", "true");
    expect(reset).toHaveClass("group/reset");
    expect(within(reset).getByText("Sending...").parentElement).toHaveClass("inline-grid", "group-hover/reset:underline");

    clickSendResetLink();
    expect(screen.getByRole("button", { name: "Sending..." })).toBe(reset);
    expect(reset).toBeDisabled();
    expect(within(reset).getByText("Email me a reset link")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();

    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Email me a reset link" })).toBeEnabled();
  });

  it("with the email already verified it offers neither resend nor refresh status", () => {
    render(<SecuritySettingsPanel />);

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh status" })).toBeNull();
    // Visible label on each field, not just the placeholder.
    expect(screen.getByLabelText("Current password")).toHaveClass("field-input");
    expect(screen.getByLabelText("New email address")).toHaveClass("field-input");
  });

  // A-10: the rules only showed up at the 1st letter (and pushed the button), and here there was no
  // eye that login and sign-up have.
  it("shows the rules before typing, linked to the field, and the eye on both passwords", () => {
    render(<SecuritySettingsPanel />);

    const next = screen.getByLabelText("New password");
    const rules = screen.getByText("Your password must include:").closest("[id]")!;
    expect(rules).toHaveTextContent("At least 8 characters");
    expect(next).toHaveAttribute("aria-describedby", rules.id);

    const eyes = screen.getAllByRole("button", { name: "Show password" });
    expect(eyes).toHaveLength(2);
    fireEvent.click(eyes[1]);
    expect(next).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
    // One name only; the state comes from aria-pressed. The field name is only the label.
    expect(eyes[1]).toHaveAttribute("aria-pressed", "true");
    expect(eyes[0]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("textbox", { name: "New password" })).toBe(next);
  });

  // F-12: the two grayed-out buttons said nothing. Now they say what is missing,
  // linked to them, and the sentence goes away together with the lock.
  it("the grayed-out buttons say what is missing, linked to them", () => {
    render(<SecuritySettingsPanel />);

    const send = screen.getByRole("button", { name: "Send change confirmation" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Type the new email address first.");
    fireEvent.change(screen.getByLabelText("New email address"), { target: { value: "new@example.com" } });
    expect(send).toBeEnabled();
    expect(send).not.toHaveAttribute("aria-describedby");

    const update = screen.getByRole("button", { name: "Update password" });
    expect(update).toHaveAccessibleDescription("Enter your current password first.");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "OldPassword1!" } });
    expect(update).toHaveAccessibleDescription("Choose a new password that meets the rules above.");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword42!" } });
    expect(update).toBeEnabled();
    expect(update).not.toHaveAttribute("aria-describedby");
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
