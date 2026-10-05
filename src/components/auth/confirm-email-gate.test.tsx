import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmEmailGate } from "@/components/auth/confirm-email-gate";

/**
 * Quem confirma o e-mail em outra aba (o link abre ao lado) deixava a aba do
 * cadastro parada para sempre em "confirme seu e-mail". A porta agora olha de
 * novo, sozinha, de tempos em tempos e quando a aba volta ao foco.
 */

const mocks = vi.hoisted(() => ({
  refreshCurrentUserEmailVerification: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  refreshCurrentUserEmailVerification: mocks.refreshCurrentUserEmailVerification,
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
