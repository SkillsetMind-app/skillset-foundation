import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";

const mocks = vi.hoisted(() => ({
  // Stable identities: Next's real useRouter/useSearchParams keep the same
  // object across renders. Fresh literals here would change the effect deps on
  // every state update and re-subscribe, hiding the very bug under test.
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  completeUserOnboarding: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ locale: "en", t: (key: string) => key }),
}));

// Stands in for the real Supabase subscription so a test can fire the auth
// callback as often as GoTrue would.
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
  completeUserOnboarding: mocks.completeUserOnboarding,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
}));

function emitAuthenticated() {
  for (const listener of mocks.listeners) {
    listener({
      status: "authenticated",
      user: { uid: "learner-1", displayName: "Patrick", emailVerified: true },
    });
  }
}

afterEach(cleanup);

describe("OnboardingChoice bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
    mocks.searchParams = new URLSearchParams();
    mocks.getUserProfile.mockResolvedValue(null);
  });

  // Supabase re-fires onAuthStateChange on TOKEN_REFRESHED / USER_UPDATED —
  // the hourly refresh, a tab regaining focus, the email-verification round
  // trip this screen itself triggers. The old code re-read the profile on
  // every one of those and pushed the stored values back into displayName,
  // username, bio, timezone and goals, silently wiping a half-filled form
  // under someone who was still typing in it.
  it("seeds the profile once, not on every later auth event", async () => {
    render(<OnboardingChoice />);

    await act(async () => {
      emitAuthenticated();
    });

    // Control: the first event must still seed, or the screen never loads.
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAuthenticated();
      emitAuthenticated();
    });

    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });
});

describe("H3: pais na ativacao do professor", () => {
  const previousAnswers = { profileConfirmed: true, primaryGoal: ["Business"], sourceOfDiscovery: "Podcast" };
  const profile = {
    displayName: "Patrick", username: "patrick", bio: "", timezone: "America/Sao_Paulo",
    goals: ["teach_online"], roles: ["student"], teacherTermsAcceptedAt: "2026-10-01",
    onboardingCompleted: true, onboardingPath: "teacher", onboardingAnswers: previousAnswers,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(profile);
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.completeUserOnboarding.mockResolvedValue(undefined);
  });

  async function mount() {
    render(<OnboardingChoice />);
    await act(async () => emitAuthenticated());
  }

  it.each(["teacher", "student"])("quem terminou como %s ativa ensino sem repetir o questionario", async (path) => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingPath: path });
    await mount();
    expect(screen.getByText("onboarding.streamlinedTitle")).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    const finish = screen.getByRole("button", { name: "onboarding.activateTeaching" });
    expect(finish).toBeDisabled();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(finish);
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "CA" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
      identity: { displayName: "Patrick", username: "patrick", bio: "", timezone: "America/Sao_Paulo", goals: ["teach_online"] },
    });
    expect(mocks.updateOnboardingAnswers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.completeUserOnboarding.mock.invocationCallOrder[0]);
  });

  it("retoma outro pais com aviso, sem alterar a resposta num evento de autenticacao", async () => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingAnswers: { ...previousAnswers, payoutCountry: "other" } });
    await mount();
    const country = screen.getByLabelText("connectOnboarding.countryLabel");
    expect(country).toHaveValue("other");
    expect(screen.getByRole("status")).toHaveTextContent("onboarding.payoutCountryUnavailable");
    fireEvent.change(country, { target: { value: "GB" } });
    await act(async () => emitAuthenticated());
    expect(country).toHaveValue("GB");
    fireEvent.change(country, { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith({
      uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "other" },
    }));
  });

  it("nao ativa nem navega quando salvar o pais falha", async () => {
    mocks.updateOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await screen.findByText("onboarding.errorFinish");
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
  });

  it.each(["teacher", "student"])("fluxo direto %s mostra e grava pais somente para professor", async (path) => {
    mocks.searchParams = new URLSearchParams(`path=${path}`);
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted: false });
    await mount();
    if (path === "teacher") {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
      expect(screen.getByText("onboarding.payoutCountryRequired")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "other" } });
    } else {
      expect(screen.queryByLabelText("connectOnboarding.countryLabel")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue("America/Sao_Paulo");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    await waitFor(() => expect(mocks.completeUserOnboarding).toHaveBeenCalledTimes(1));
    if (path === "teacher") {
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
        uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "other" },
      });
    } else {
      expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    }
  });
});
