import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { PageHeadingProvider, PageHeadingText } from "@/components/auth/page-heading";

const mocks = vi.hoisted(() => ({
  // Stable identities: Next's real useRouter/useSearchParams keep the same
  // object across renders. Fresh literals here would change the effect deps on
  // every state update and re-subscribe, hiding the very bug under test.
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  completeUserOnboarding: vi.fn(),
  refreshUser: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ refreshUser: mocks.refreshUser }),
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
      user: { uid: "learner-1", displayName: "Preston", emailVerified: true },
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

describe("H3: country in the teacher activation", () => {
  const previousAnswers = { profileConfirmed: true, primaryGoal: ["Business"], sourceOfDiscovery: "Podcast" };
  const profile = {
    displayName: "Preston", username: "preston", bio: "", timezone: "America/Sao_Paulo",
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

  it.each(["teacher", "student"])("someone who finished as %s activates teaching without repeating the questionnaire", async (path) => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingPath: path });
    await mount();
    expect(screen.getByRole("button", { name: "onboarding.activateTeaching" })).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    // Email already verified: the verification card does not show again, and the
    // box text does not ask to verify what is already verified.
    expect(screen.queryByText("onboarding.emailVerificationTitle")).toBeNull();
    expect(screen.getByText("onboarding.streamlinedDescVerified")).toBeInTheDocument();
    expect(screen.queryByText("onboarding.streamlinedDesc")).toBeNull();
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
      identity: { displayName: "Preston", username: "preston", bio: "", timezone: "America/Sao_Paulo", goals: ["teach_online"] },
    });
    expect(mocks.updateOnboardingAnswers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.completeUserOnboarding.mock.invocationCallOrder[0]);
  });

  // A-20 / O-06: the title follows the screen the profile decides, not the address.
  // With ?path=teacher the 3-step signup also opens (someone who did not finish the
  // signup, a new invite, a profile that did not load), and there the page title
  // stays the default.
  function mountOnPage() {
    render(
      <PageHeadingProvider>
        <h1><PageHeadingText part="title" fallback="page.title" /></h1>
        <p><PageHeadingText part="description" fallback="page.description" /></p>
        <OnboardingChoice />
      </PageHeadingProvider>,
    );
    return act(async () => emitAuthenticated());
  }

  it("the short activation swaps the page title and description", async () => {
    await mountOnPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    expect(screen.getAllByText("onboarding.streamlinedDescVerified")).toHaveLength(1);
    expect(screen.queryByText("page.description")).toBeNull();
  });

  it.each([
    ["quem nao terminou o cadastro", () => mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted: false })],
    ["perfil que nao carregou", () => mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"))],
  ])("%s sees the 3-step signup under the default title", async (_caso, arrange) => {
    arrange();
    await mountOnPage();

    expect(screen.getByRole("button", { name: "onboarding.continue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(screen.getByText("page.description")).toBeInTheDocument();
    expect(screen.queryByText("onboarding.streamlinedTitle")).toBeNull();
  });

  // A-20: "Activate teaching" was grayed out without saying what was missing. The lock is
  // the same; the reason now shows and describes the button.
  it("says why 'Activate teaching' is grayed out, without changing the lock", async () => {
    await mount();
    const finish = screen.getByRole("button", { name: "onboarding.activateTeaching" });
    expect(finish).toBeDisabled();
    const reason = screen.getByText("onboarding.payoutCountryRequired");
    expect(finish).toHaveAttribute("aria-describedby", reason.id);

    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    expect(finish).toBeEnabled();
    expect(finish).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("onboarding.payoutCountryRequired")).toBeNull();
  });

  // The plan chosen on /pricing arrives here as returnTo. Before, the end was
  // always /teach and the teacher had to find the plans and choose again.
  async function ativar(query: string) {
    mocks.searchParams = new URLSearchParams(query);
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledTimes(1));
    expect(mocks.completeUserOnboarding).toHaveBeenCalledTimes(1);
    return mocks.router.push.mock.calls[0][0];
  }
  const cartao = "/account/billing/upgrade?plan=starter&cycle=yearly";

  it("with a plan chosen on /pricing, the end opens that plan's card screen", async () => {
    expect(await ativar(new URLSearchParams({ path: "teacher", returnTo: cartao }).toString())).toBe(cartao);
  });

  it("without a chosen plan, the end stays on /teach", async () => {
    expect(await ativar("path=teacher")).toBe("/teach");
  });

  // The short activation only asks what is missing: the country already answered in the
  // interview does not come back, and stays saved the same in the activation.
  it("a country already answered does not show again and stays saved", async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile, onboardingAnswers: { ...previousAnswers, payoutCountry: "US" },
    });
    await mount();
    expect(screen.queryByLabelText("connectOnboarding.countryLabel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "US" },
    });
  });

  it("the country field does not vanish in the middle of the choice", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("CA");
  });

  it.each([
    "/account/billing/upgrade?plan=plus&cycle=monthly",
    "/account/billing/upgrade?plan=starter&cycle=weekly",
    "/account/billing/upgrade?plan=starter",
    "/courses/focus",
    "https://evil.example/account/billing/upgrade?plan=pro&cycle=yearly",
  ])("a destination that is not a public plan is ignored: %s", async (returnTo) => {
    expect(await ativar(new URLSearchParams({ path: "teacher", returnTo }).toString())).toBe("/teach");
  });

  it("whoever skips the activation does not open the card screen", async () => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: cartao });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.skipForNow" }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/learn");
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("resumes another country with a notice, without changing the answer on an auth event", async () => {
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

  it("neither activates nor navigates when saving the country fails", async () => {
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

  // Without the profile read, finishing wrote over the saved profile
  // (roles, name, @, bio, timezone and goals) with what was on screen. Now
  // nothing is written and nobody gets past step 0: "Continue" leaves the read notice
  // and "Try again" in place.
  it("profile read failed: Continue does not leave step 0 and nothing is written", async () => {
    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(screen.getByText("onboarding.errorProfileLoadRetry")).toBeInTheDocument();
    fireEvent.click(screen.getByText("onboarding.pathTeachTitle"));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));

    expect(screen.queryByPlaceholderText("onboarding.usernamePlaceholder")).toBeNull();
    expect(screen.queryByRole("button", { name: "onboarding.finishSetup" })).toBeNull();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
    expect(mocks.refreshUser).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(screen.getByText("onboarding.pathTeachTitle")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
  });

  it.each(["teacher", "student"])("direct flow %s shows and writes the country only for teachers", async (path) => {
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

  // The full signup (3 steps) ends in the same place as the short activation;
  // the learner does not open a plan card even if the address carries one.
  it.each([
    ["teacher", cartao],
    ["student", "/learn"],
  ])("direct flow %s with a chosen plan ends at %s", async (path, destino) => {
    mocks.searchParams = new URLSearchParams({ path, returnTo: cartao });
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted: false });
    await mount();
    if (path === "teacher") {
      fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith(destino));
  });

  // F-04: the waiting button does not change width. Both labels live in the
  // same cell; the one that does not apply is hidden from the reader, so the button
  // name is always the visible text. Lock, type and action stay the same.
  it.each([
    ["ativação curta", true, "onboarding.activateTeaching", "onboarding.activating"],
    ["cadastro completo", false, "onboarding.finishSetup", "onboarding.saving"],
  ] as const)("%s: the final button states the wait without changing width", async (_label, onboardingCompleted, idle, busy) => {
    let release!: () => void;
    mocks.updateOnboardingAnswers.mockReturnValue(new Promise<void>((resolve) => { release = () => resolve(); }));
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted });
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    if (!onboardingCompleted) {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
      fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    }

    const button = screen.getByRole("button", { name: idle });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeEnabled();
    expect(within(button).getByText(busy)).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(button);
    expect(button).toHaveAccessibleName(busy);
    expect(button).toBeDisabled();
    // Rest and wait in the same grid cell: the width is the larger one's.
    const idleFace = within(button).getByText(idle);
    expect(idleFace).toHaveAttribute("aria-hidden", "true");
    expect(idleFace.parentElement).toBe(within(button).getByText(busy).parentElement);

    await act(async () => release());
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledTimes(1);
    expect(mocks.completeUserOnboarding).toHaveBeenCalledTimes(1);
  });
});
