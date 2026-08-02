import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { resetPassword } from "@/lib/auth/supabase-auth";

// Only the network call is faked. isEmailRateLimitError / getAuthErrorMessage
// stay real, because which branch a GoTrue error takes is exactly what the
// reported bug was about.
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  resetPassword: vi.fn(),
}));

const mockedResetPassword = vi.mocked(resetPassword);

function submitEmail(email = "learner@example.com") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("ResetPasswordForm feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no layout, so it ships no scrollIntoView. The component calls
    // it through a ref to drag the feedback box into view on a phone.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("announces the sent confirmation and scrolls it into view", async () => {
    mockedResetPassword.mockResolvedValue(undefined);
    render(<ResetPasswordForm />);

    submitEmail();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("we've sent a reset link");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // The reported bug: pressing the button a second time set the identical
  // string, React saw no change, nothing moved on screen, and the user could
  // not tell whether the second press did anything.
  it("re-reveals the confirmation when the same email is submitted twice", async () => {
    mockedResetPassword.mockResolvedValue(undefined);
    render(<ResetPasswordForm />);

    submitEmail();
    await screen.findByRole("status");

    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    submitEmail();
    await screen.findByRole("status");

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // The send limit only trips because an earlier link already went out, so
  // reporting it as a failure sends people hunting for a problem that is not
  // there.
  it("treats the email send limit as reassurance, not an error", async () => {
    mockedResetPassword.mockRejectedValue({
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 60s",
      status: 429,
    });
    render(<ResetPasswordForm />);

    submitEmail();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("We already sent a reset link");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still surfaces real failures as errors", async () => {
    mockedResetPassword.mockRejectedValue({
      message: "Network request failed",
      status: 500,
    });
    render(<ResetPasswordForm />);

    submitEmail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/./);
    expect(screen.queryByRole("status")).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
