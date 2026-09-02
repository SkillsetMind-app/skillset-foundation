import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingWizard } from "@/components/auth/onboarding-wizard";

/**
 * O primeiro passo depois de confirmar o e-mail e se apresentar: nome
 * (pre-preenchido do cadastro) e telefone — que nunca era pedido em lugar
 * nenhum. So depois vem "como voce vai usar a SkillsetMind".
 */

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  // Objeto estavel: um novo por render reinscreve efeitos e entra em laco.
  auth: {
    status: "authenticated",
    user: { uid: "u-1", email: "patrick@example.com", displayName: "Patrick Simon", roles: ["student"] },
  },
  profile: {
    displayName: "Patrick Simon",
    phoneNumber: null as string | null,
    onboardingAnswers: {} as Record<string, unknown>,
  },
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  updateUserIdentity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
  updateUserIdentity: mocks.updateUserIdentity,
}));

describe("boas-vindas: o passo de perfil vem primeiro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = { displayName: "Patrick Simon", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("abre pedindo nome (ja preenchido) e telefone; sem telefone nao passa", async () => {
    render(<OnboardingWizard />);

    expect(await screen.findByText("First, tell us who you are.")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Patrick Simon");
    expect(screen.getByLabelText("Phone")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("com nome e telefone: grava no perfil, marca o passo e segue para o proximo", async () => {
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+55 (16) 99999-1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(mocks.updateUserIdentity).toHaveBeenCalledWith("u-1", {
        displayName: "Patrick Simon",
        phoneNumber: "+55 (16) 99999-1234",
      }),
    );
    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ uid: "u-1", answers: expect.objectContaining({ profileConfirmed: true }) }),
      ),
    );
    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();
  });

  it("quem ja se apresentou nao ve o passo de novo ao voltar", async () => {
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+55 16 99999-1234",
      onboardingAnswers: { profileConfirmed: true },
    };
    render(<OnboardingWizard />);

    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();
    expect(screen.queryByText("First, tell us who you are.")).toBeNull();
  });
});
