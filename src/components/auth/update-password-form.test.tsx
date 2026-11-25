import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { I18nProvider } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({
  auth: { status: "authenticated" as string },
  completePasswordRecovery: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  completePasswordRecovery: mocks.completePasswordRecovery,
}));

const newSecret = "UnchangedPassword42!";

function renderForm(recoveryVerified = true) {
  return render(
    <I18nProvider initialLocale="en">
      <UpdatePasswordForm recoveryVerified={recoveryVerified} />
    </I18nProvider>,
  );
}

// A-10 and A-12 on the password change from the email link: rules before typing,
// outside the <label>; the eye on both fields; and the big title stating the state.
describe("UpdatePasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: "authenticated" };
  });
  afterEach(cleanup);

  it("shows the rules before the first letter, tied to the field, and one eye per field", () => {
    renderForm();

    expect(screen.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeInTheDocument();
    const field = screen.getByLabelText("New password");
    const rules = screen.getByText("Your password must include:").closest("[id]")!;
    expect(field).toHaveAttribute("aria-describedby", rules.id);
    expect(rules.closest("label")).toBeNull();

    const eyes = screen.getAllByRole("button", { name: "Show password" });
    expect(eyes).toHaveLength(2);
    fireEvent.click(eyes[0]);
    expect(field).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    // One name only, state in aria-pressed; and the field's name is just the label
    // (with the eye inside the <label> it became "New password Show password").
    expect(eyes[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "New password" })).toBe(field);
    fireEvent.click(eyes[1]);
    expect(screen.getByRole("textbox", { name: "Confirm new password" })).toHaveAttribute("autocomplete", "new-password");
  });

  it("different passwords: the notice stays outside the label and describes the field", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: newSecret } });
    const confirm = screen.getByLabelText("Confirm new password");
    fireEvent.change(confirm, { target: { value: "different" } });

    const warning = screen.getByText("The two passwords do not match.");
    expect(warning.closest("label")).toBeNull();
    expect(confirm).toHaveAttribute("aria-describedby", warning.id);
  });

  // F-12: the dimmed button says why, tied to it, and the sentence goes away when
  // the lock is lifted. Mismatched passwords: it points to the notice that already exists.
  it("the dimmed button says what is missing, tied to it", () => {
    renderForm();
    const update = screen.getByRole("button", { name: "Update password" });
    expect(update).toBeDisabled();
    // Before typing, an invitation, not the error sentence.
    expect(update).toHaveAccessibleDescription("Choose a password that meets the rules above.");

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: newSecret } });
    expect(update).toHaveAccessibleDescription("Type the password again to confirm it.");

    const confirm = screen.getByLabelText("Confirm new password");
    fireEvent.change(confirm, { target: { value: "different" } });
    expect(update).toHaveAccessibleDescription("The two passwords do not match.");
    expect(screen.getAllByText("The two passwords do not match.")).toHaveLength(1);

    fireEvent.change(confirm, { target: { value: newSecret } });
    expect(update).toBeEnabled();
    expect(update).not.toHaveAttribute("aria-describedby");
  });

  it("expired link: the title says so, and the form does not appear", () => {
    renderForm(false);

    expect(screen.getByRole("heading", { level: 1, name: "This link has expired" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("password changed: the title says it worked", async () => {
    mocks.completePasswordRecovery.mockResolvedValue(undefined);
    renderForm();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: newSecret } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: newSecret } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your password has been updated." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You're signed in and can use it next time.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(mocks.completePasswordRecovery).toHaveBeenCalledExactlyOnceWith(newSecret);
  });
});
