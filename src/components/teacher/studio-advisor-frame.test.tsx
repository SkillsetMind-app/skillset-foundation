import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeachLayout from "@/app/teach/layout";

vi.mock("@/lib/advisor/config", () => ({ isAdvisorEnabled: true }));

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
  fetchRequireCreatorVerification: vi.fn().mockResolvedValue(false),
}));

async function renderLayout(children = <p>Private studio</p>) {
  const view = render(<TeachLayout>{children}</TeachLayout>);
  await act(async () => {});
  return view;
}

describe("/teach layout", () => {
  beforeEach(() => {
    state.roles = ["teacher"];
    state.uid = "teacher-1";
    state.pathname = "/teach/courses";
    blockedMock.mockReset().mockResolvedValue(true);
  });

  // The fee is charged at the first Publish now, so an unpaid creator must
  // reach the studio itself: no wall, no activation check on arrival.
  it("opens the studio to an unpaid creator without an activation wall", async () => {
    await renderLayout();
    expect(screen.getByText("Private studio")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(blockedMock).not.toHaveBeenCalled();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("mounts the advisor for a creator in the studio", async () => {
    await renderLayout();
    expect(screen.getByRole("button", { name: /advisor/i })).toBeInTheDocument();
  });

  it.each(["/teach/activate", "/teach/activate/return", "/teach/verification"])(
    "renders %s without the advisor",
    async (pathname) => {
      state.pathname = pathname;
      await renderLayout(<p>Secure checkout</p>);
      expect(screen.getByText("Secure checkout")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /advisor/i })).toBeNull();
    },
  );

  it("does not mount the advisor for a learner", async () => {
    state.roles = ["student"];
    await renderLayout();
    expect(screen.getByText("Private studio")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /advisor/i })).toBeNull();
  });

  it("keeps the studio subtree and an unsent draft during ordinary navigation", async () => {
    const view = await renderLayout(<input aria-label="Advisor draft" />);
    const draft = screen.getByLabelText("Advisor draft");
    fireEvent.change(draft, { target: { value: "Unsent question" } });
    state.pathname = "/teach/events";
    view.rerender(<TeachLayout><input aria-label="Advisor draft" /></TeachLayout>);
    expect(screen.getByLabelText("Advisor draft")).toBe(draft);
    expect(draft).toHaveValue("Unsent question");
  });
});
