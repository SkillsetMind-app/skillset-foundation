import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivationGate } from "@/components/teacher/activation-gate";

// Mutable so a test can change viewer or route without a fresh module graph.
const state = vi.hoisted(() => ({
  roles: ["teacher"] as string[],
  pathname: "/teach/courses",
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-1", roles: state.roles } }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

const blockedMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: blockedMock,
}));

/** Renders and lets the activation verdict settle before asserting. */
async function renderGate() {
  render(<ActivationGate />);
  await act(async () => {});
}

describe("ActivationGate", () => {
  beforeEach(() => {
    state.roles = ["teacher"];
    state.pathname = "/teach/courses";
    blockedMock.mockReset();
    blockedMock.mockResolvedValue(false);
  });

  it("walls off the studio and sends the creator to checkout when the fee is unpaid", async () => {
    blockedMock.mockResolvedValue(true);

    await renderGate();

    expect(
      screen.getByRole("dialog", { name: "Activate your storefront" }),
    ).toBeInTheDocument();
    // The gate never opens a Stripe session itself — /teach/activate owns that.
    expect(
      screen.getByRole("link", { name: "Pay $25 and unlock the studio" }),
    ).toHaveAttribute("href", "/teach/activate");
  });

  it("stays out of the way once the fee is paid", async () => {
    await renderGate();

    expect(blockedMock).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never gates the checkout route itself", async () => {
    // Gating /teach/activate would trap the creator: the only way to pay is the
    // page the dialog is covering.
    state.pathname = "/teach/activate";
    blockedMock.mockResolvedValue(true);

    await renderGate();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(blockedMock).not.toHaveBeenCalled();
  });

  it("never gates the return leg from Stripe", async () => {
    state.pathname = "/teach/activate/return";
    blockedMock.mockResolvedValue(true);

    await renderGate();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask a learner to pay for a studio they never requested", async () => {
    state.roles = ["student"];
    blockedMock.mockResolvedValue(true);

    await renderGate();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(blockedMock).not.toHaveBeenCalled();
  });

  it("releases the scroll lock when the creator leaves for checkout", async () => {
    // The verdict stays true across this navigation — only the route changes.
    // Keying the focus trap and the scroll lock off the raw verdict froze the
    // page with no dialog left on screen to explain why.
    blockedMock.mockResolvedValue(true);

    const { rerender } = render(<ActivationGate />);
    await act(async () => {});
    expect(document.body.style.overflow).toBe("hidden");

    state.pathname = "/teach/activate";
    rerender(<ActivationGate />);
    await act(async () => {});

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("fails open when the verdict cannot be read", async () => {
    // A network blip must not lock a creator who already paid out of their own
    // studio. Publishing stays gated in SQL by the courses trigger regardless.
    blockedMock.mockRejectedValue(new Error("offline"));

    await renderGate();

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
