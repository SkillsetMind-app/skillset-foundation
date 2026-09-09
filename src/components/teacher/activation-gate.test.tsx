import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivationGate } from "@/components/teacher/activation-gate";
import TeachLayout from "@/app/teach/layout";
vi.mock("@/lib/advisor/config", () => ({ isAdvisorEnabled: true }));

// Mutable so a test can change viewer or route without a fresh module graph.
const state = vi.hoisted(() => ({
  roles: ["teacher"] as string[],
  pathname: "/teach/courses",
  uid: "teacher-1",
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: state.uid, roles: state.roles } }),
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
    state.uid = "teacher-1";
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

  it.each(["/teach/activate", "/teach/activate/return"])("allows %s without mounting the real Advisor", async (pathname) => {
    state.pathname = pathname;
    blockedMock.mockResolvedValue(true);
    render(<TeachLayout><p>Secure checkout</p></TeachLayout>);
    await act(async () => {});
    expect(screen.getByText("Secure checkout")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /advisor/i })).toBeNull();
    expect(blockedMock).not.toHaveBeenCalled();
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

  it("keeps the studio unmounted on failure and retries without asking for another payment", async () => {
    blockedMock.mockRejectedValue(new Error("offline"));
    render(<ActivationGate><p>Private studio</p></ActivationGate>);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Private studio")).toBeNull();
    expect(screen.queryByRole("link", { name: "Pay $25 and unlock the studio" })).toBeNull();
    blockedMock.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Private studio")).toBeInTheDocument();
    expect(blockedMock).toHaveBeenCalledTimes(2);
  });

  it("does not mount the real layout children while checking or when unpaid", async () => {
    let resolve!: (blocked: boolean) => void;
    blockedMock.mockImplementation(() => new Promise<boolean>((done) => { resolve = done; }));
    const mounted = vi.fn();
    function Studio() { mounted(); return <p>Private studio</p>; }
    render(<TeachLayout><Studio /></TeachLayout>);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => resolve(true));
    expect(screen.getByRole("dialog", { name: "Activate your storefront" })).toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
  });

  it("does not reuse another account's allowance while its own verdict is pending", async () => {
    const { rerender } = render(<ActivationGate><p>Private studio</p></ActivationGate>);
    expect(await screen.findByText("Private studio")).toBeInTheDocument();
    state.uid = "teacher-2";
    let resolve!: (blocked: boolean) => void;
    blockedMock.mockImplementation(() => new Promise<boolean>((done) => { resolve = done; }));
    rerender(<ActivationGate><p>Private studio</p></ActivationGate>);
    expect(screen.queryByText("Private studio")).toBeNull();
    await act(async () => resolve(true));
    expect(screen.queryByText("Private studio")).toBeNull();
  });

  it("rechecks after returning from checkout even if an older visit was allowed", async () => {
    const { rerender } = render(<ActivationGate><p>Private studio</p></ActivationGate>);
    expect(await screen.findByText("Private studio")).toBeInTheDocument();
    state.pathname = "/teach/activate/return";
    rerender(<ActivationGate><p>Stripe return</p></ActivationGate>);
    expect(screen.getByText("Stripe return")).toBeInTheDocument();
    blockedMock.mockResolvedValue(true);
    state.pathname = "/teach/courses";
    rerender(<ActivationGate><p>Private studio</p></ActivationGate>);
    expect(screen.queryByText("Private studio")).toBeNull();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Activate your storefront" })).toBeInTheDocument());
    expect(screen.queryByText("Private studio")).toBeNull();
  });

  it("preserves the allowed studio subtree and draft during ordinary page navigation", async () => {
    const view = render(<TeachLayout><input aria-label="Advisor draft" /></TeachLayout>);
    const draft = await screen.findByLabelText("Advisor draft");
    fireEvent.change(draft, { target: { value: "Unsent question" } });
    state.pathname = "/teach/events";
    view.rerender(<TeachLayout><input aria-label="Advisor draft" /></TeachLayout>);
    expect(screen.getByLabelText("Advisor draft")).toBe(draft);
    expect(draft).toHaveValue("Unsent question");
    expect(blockedMock).toHaveBeenCalledTimes(1);
  });
});
