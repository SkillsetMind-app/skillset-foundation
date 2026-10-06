import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Aceitar os termos de professor publica o perfil (20261006020000): a tela diz
// o que fica público e onde, ao lado da caixa dos termos.
const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams("path=teacher"),
  getUserProfile: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => translate(getDictionary("en"), key) }),
}));
vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: (callback: (session: unknown) => void) => {
    mocks.listeners.push(callback);
    return () => {
      mocks.listeners = mocks.listeners.filter((entry) => entry !== callback);
    };
  },
  refreshCurrentUserEmailVerification: vi.fn(),
  sendSkillsetEmailVerification: vi.fn(),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  completeUserOnboarding: vi.fn(),
}));

async function signIn() {
  await act(async () => {
    for (const listener of mocks.listeners) {
      listener({ status: "authenticated", user: { uid: "teacher-1", displayName: "Ana", emailVerified: true } });
    }
  });
}

describe("OnboardingChoice: o perfil de professor é público", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
  });
  afterEach(cleanup);

  it("ativação rápida: diz o endereço com o @ que o professor já tem", async () => {
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: true,
      onboardingPath: "teacher",
      roles: ["student"],
      goals: [],
      username: "ana",
    });
    render(<OnboardingChoice />);
    await signIn();

    expect(await screen.findByText(
      "Your teacher profile (name, photo, bio and credentials) is public at skillsetmind.com/@ana.",
    )).toBeInTheDocument();
  });

  it("fluxo completo, antes de escolher o @: mostra o formato do endereço", async () => {
    mocks.getUserProfile.mockResolvedValue(null);
    render(<OnboardingChoice />);
    await signIn();

    expect(await screen.findByText(
      "Your teacher profile (name, photo, bio and credentials) is public at skillsetmind.com/@your-name.",
    )).toBeInTheDocument();
  });
});
