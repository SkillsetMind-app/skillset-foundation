import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlansForTeachersOnly } from "@/components/account/plans-for-teachers-only";

// "Plans & fees" left the learner's menu, but /account/plans stayed open
// by address. Plans are what the teacher pays to sell.

const mocks = vi.hoisted(() => ({
  roles: ["student"] as string[],
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: { uid: "u-1", roles: mocks.roles } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/account/plans", () => {
  it("the learner goes to My purchases, without seeing the plans", () => {
    mocks.roles = ["student"];
    render(<PlansForTeachersOnly><p>Plans</p></PlansForTeachersOnly>);

    expect(screen.queryByText("Plans")).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing");
  });

  it("the teacher still sees the plans", () => {
    mocks.roles = ["teacher"];
    render(<PlansForTeachersOnly><p>Plans</p></PlansForTeachersOnly>);

    expect(screen.getByText("Plans")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
