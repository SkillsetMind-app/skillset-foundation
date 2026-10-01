import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TotpMfaSection } from "@/components/account/totp-mfa-section";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { safeQrDataUri } from "@/lib/auth/supabase-auth";

const mocks = vi.hoisted(() => ({
  calls: {
    listEnrolledTotpFactors: vi.fn(),
    startTotpEnrollment: vi.fn(),
    finishTotpEnrollment: vi.fn(),
    unenrollTotpFactor: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/feature-flags", () => ({ isPublicFeatureEnabled: () => true }));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  ...mocks.calls,
}));

const QR = "data:image/svg+xml;utf-8,<svg xmlns='http://www.w3.org/2000/svg'></svg>";
const setup = {
  secret: { factorId: "test-factor" },
  secretKey: "TESTSETUPKEY",
  otpauthUrl: "otpauth://totp/test-only",
  qrCode: QR as string | null,
};

function renderSection() {
  return render(
    <I18nProvider initialLocale="en">
      <TotpMfaSection emailVerified />
    </I18nProvider>,
  );
}

async function openDialog() {
  const trigger = await screen.findByRole("button", { name: "Set up authenticator" });
  trigger.focus();
  await act(async () => fireEvent.click(trigger));
  return { trigger, dialog: await screen.findByRole("dialog") };
}

describe("TOTP setup dialog", () => {
  beforeEach(() => {
    for (const call of Object.values(mocks.calls)) call.mockReset();
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([]);
    mocks.calls.startTotpEnrollment.mockResolvedValue({ ...setup });
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("opens a labelled modal with the QR code and the manual key as fallback", async () => {
    renderSection();
    const { dialog } = await openDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Set up two-factor authentication");
    expect(dialog.className).toContain("modal-panel");
    const qr = within(dialog).getByRole("img", {
      name: "QR code to add this account to your authenticator app",
    });
    expect(qr).toHaveAttribute("src", QR);
    expect(within(dialog).getByText("Scan this QR code with the app.")).toBeInTheDocument();
    expect(within(dialog).getByText("Can’t scan it? Type this key into the app instead.")).toBeInTheDocument();
    expect(within(dialog).getByText(setup.secretKey)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "open this setup link" })).toHaveAttribute("href", setup.otpauthUrl);
    expect(within(dialog).getByLabelText("Authenticator code")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("falls back to the link-and-key steps when there is no QR", async () => {
    mocks.calls.startTotpEnrollment.mockResolvedValue({ ...setup, qrCode: null });
    renderSection();
    const { dialog } = await openDialog();

    expect(within(dialog).queryByRole("img")).toBeNull();
    expect(within(dialog).getByText(/Add an account, then/)).toBeInTheDocument();
    expect(within(dialog).getByText(setup.secretKey)).toBeInTheDocument();
  });

  it("closes on Escape without enrolling and returns focus to the trigger", async () => {
    renderSection();
    const { trigger, dialog } = await openDialog();
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
    expect(mocks.calls.finishTotpEnrollment).not.toHaveBeenCalled();
    expect(mocks.calls.unenrollTotpFactor).not.toHaveBeenCalled();
  });

  it("closes on Cancel and returns focus to the trigger", async () => {
    renderSection();
    const { trigger, dialog } = await openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab focus inside the dialog", async () => {
    renderSection();
    const { dialog } = await openDialog();
    // jsdom has no layout; give every element a rect so the focus trap sees it.
    const rects = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{}] as unknown as DOMRectList);
    try {
      const cancel = within(dialog).getByRole("button", { name: "Cancel" });
      cancel.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(cancel);
    } finally {
      rects.mockRestore();
    }
  });

  it("enrolls with the code from the dialog, then closes it and shows the factor", async () => {
    mocks.calls.finishTotpEnrollment.mockResolvedValue(undefined);
    renderSection();
    const { dialog } = await openDialog();
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([
      { uid: "test-factor", displayName: "Authenticator app", enrolledAt: null },
    ]);

    fireEvent.change(within(dialog).getByLabelText("Authenticator code"), { target: { value: "123456" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Turn on 2FA" })));

    expect(mocks.calls.finishTotpEnrollment).toHaveBeenCalledExactlyOnceWith(setup.secret, "123456", "Authenticator app");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Two-factor authentication is on. Your account is protected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });

  it("keeps the dialog open with the error when the code is wrong", async () => {
    mocks.calls.finishTotpEnrollment.mockRejectedValue({ code: "invalid_otp", message: "detail" });
    renderSection();
    const { dialog } = await openDialog();

    fireEvent.change(within(dialog).getByLabelText("Authenticator code"), { target: { value: "000000" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Turn on 2FA" })));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("That code didn't match.");
  });

  it("leaves an already-enrolled account able to turn 2FA off, with no dialog", async () => {
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([
      { uid: "existing-factor", displayName: "Authenticator app", enrolledAt: null },
    ]);
    mocks.calls.unenrollTotpFactor.mockResolvedValue(undefined);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    mocks.calls.listEnrolledTotpFactors.mockResolvedValue([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes, turn off" })));

    expect(mocks.calls.unenrollTotpFactor).toHaveBeenCalledExactlyOnceWith("existing-factor");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.calls.startTotpEnrollment).not.toHaveBeenCalled();
  });
});

describe("safeQrDataUri", () => {
  it("accepts only an SVG data URI", () => {
    expect(safeQrDataUri(QR)).toBe(QR);
    expect(safeQrDataUri("javascript:alert(1)")).toBeNull();
    expect(safeQrDataUri("data:text/html,<script></script>")).toBeNull();
    expect(safeQrDataUri("https://example.test/qr.svg")).toBeNull();
    expect(safeQrDataUri(undefined)).toBeNull();
  });
});
