import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlansForTeachersOnly } from "@/components/account/plans-for-teachers-only";

// "Plans & fees" saiu do menu do aluno, mas /account/plans continuava aberto
// pelo endereco. Os planos sao o que o professor paga para vender.

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
  it("o aluno vai para My purchases, sem ver os planos", () => {
    mocks.roles = ["student"];
    render(<PlansForTeachersOnly><p>Plans</p></PlansForTeachersOnly>);

    expect(screen.queryByText("Plans")).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing");
  });

  it("o professor continua vendo os planos", () => {
    mocks.roles = ["teacher"];
    render(<PlansForTeachersOnly><p>Plans</p></PlansForTeachersOnly>);

    expect(screen.getByText("Plans")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
