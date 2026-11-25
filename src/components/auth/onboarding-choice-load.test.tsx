import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { PageHeadingProvider, PageHeadingText } from "@/components/auth/page-heading";

// Reading the profile on entry to the activation/path choice: what it calls,
// how many times, and which screen comes out of each profile. Written BEFORE "Try again"
// to prove that the normal load stays the same after it.

const mocks = vi.hoisted(() => ({
  // Stable identities, like Next's: a new literal on every render would change
  // the effect dependencies and resubscribe the session.
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  listenToAuthState: vi.fn(),
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  completeUserOnboarding: vi.fn(),
  refreshUser: vi.fn(),
  sendSkillsetEmailVerification: vi.fn(),
  refreshCurrentUserEmailVerification: vi.fn(),
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

vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: mocks.listenToAuthState,
  refreshCurrentUserEmailVerification: mocks.refreshCurrentUserEmailVerification,
  sendSkillsetEmailVerification: mocks.sendSkillsetEmailVerification,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  completeUserOnboarding: mocks.completeUserOnboarding,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
}));

const authedUser = { uid: "learner-1", displayName: "Patrick", emailVerified: true };
const plan = "/account/billing/upgrade?plan=starter&cycle=yearly";
const learnerProfile = {
  displayName: "Patrick Simon", username: "patrick", bio: "Coach", timezone: "America/Sao_Paulo",
  goals: ["career_growth"], roles: ["student"], onboardingCompleted: true,
  onboardingAnswers: { profileConfirmed: true },
};
const teacherProfile = {
  ...learnerProfile, roles: ["student", "teacher"], teacherTermsAcceptedAt: "2026-10-01",
  onboardingAnswers: { profileConfirmed: true, payoutCountry: "US" },
};

function emit(session: unknown) {
  for (const listener of mocks.listeners) listener(session);
}

function mountOnPage() {
  return render(
    <PageHeadingProvider>
      <h1><PageHeadingText part="title" fallback="page.title" /></h1>
      <OnboardingChoice />
    </PageHeadingProvider>,
  );
}

// No writes, no navigation: only the read (and the session subscription).
function expectOnlyTheRead(reads: number) {
  expect(mocks.listenToAuthState).toHaveBeenCalledTimes(1);
  expect(mocks.getUserProfile).toHaveBeenCalledTimes(reads);
  if (reads) expect(mocks.getUserProfile).toHaveBeenCalledWith("learner-1");
  expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
  expect(mocks.refreshUser).not.toHaveBeenCalled();
  expect(mocks.sendSkillsetEmailVerification).not.toHaveBeenCalled();
  expect(mocks.refreshCurrentUserEmailVerification).not.toHaveBeenCalled();
  expect(mocks.router.replace).not.toHaveBeenCalled();
}

const pathButton = (key: string) => screen.getByRole("button", { name: new RegExp(`^${key}`) });
const selected = "border-[var(--color-primary)]";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listeners = [];
  mocks.searchParams = new URLSearchParams();
  mocks.listenToAuthState.mockImplementation((callback: (session: unknown) => void) => {
    mocks.listeners.push(callback);
    callback({ status: "loading", user: null });
    return () => {
      mocks.listeners = mocks.listeners.filter((entry) => entry !== callback);
    };
  });
});
afterEach(cleanup);

describe("OnboardingChoice: the normal load (characterization)", () => {
  it("waits for the session, reads the profile once and only then shows the screen", async () => {
    let resolve!: (profile: unknown) => void;
    mocks.getUserProfile.mockReturnValue(new Promise((done) => { resolve = done; }));
    mountOnPage();
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(mocks.getUserProfile).not.toHaveBeenCalled();

    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expectOnlyTheRead(1);

    await act(async () => resolve(null));
    expect(screen.queryByText("authFlow.loading.title")).toBeNull();
    expect(screen.getByRole("button", { name: "onboarding.continue" })).toBeInTheDocument();
    // The normal load does not touch the page title or the focus.
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("tabindex");
    expect(document.body).toHaveFocus();

    // Later session events (token renewal, tab focus) do not re-read.
    await act(async () => {
      emit({ status: "authenticated", user: authedUser });
      emit({ status: "authenticated", user: { ...authedUser, displayName: "Outro" } });
    });
    expectOnlyTheRead(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("without a session: goes to /login and does not read the profile", async () => {
    mountOnPage();
    await act(async () => emit({ status: "unauthenticated", user: null }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/login");
    expectOnlyTheRead(0);
  });

  it("new learner: 3-step signup with the learner path selected", async () => {
    mocks.getUserProfile.mockResolvedValue(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);
    expect(pathButton("onboarding.pathTeachTitle")).not.toHaveClass(selected);
    expect(screen.queryByLabelText("connectOnboarding.countryLabel")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Patrick");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("");
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("new teacher (?path=teacher): 3-step signup with teaching selected, country and terms still open", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(pathButton("onboarding.pathTeachTitle")).toHaveClass(selected);
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("onboarding.verified")).toBeInTheDocument();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("someone who finished as a learner and comes back to teach: short activation", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    expect(screen.getByRole("button", { name: "onboarding.activateTeaching" })).toBeDisabled();
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("a teacher who already teaches: signup with teaching selected and terms already accepted", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(teacherProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(pathButton("onboarding.pathTeachTitle")).toHaveClass(selected);
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("US");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("with a chosen plan (returnTo): the same short activation, without navigating on load", async () => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: plan });
    mocks.getUserProfile.mockResolvedValue(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    });
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith(plan);
  });

  // A brand-new signup from end to end. A read that comes back empty (no row, or the
  // row just created by the signup trigger) concludes as always: same
  // calls, same content, same destination.
  const freshRow = {
    uid: "learner-1", email: "patrick@example.com", displayName: null, username: null, bio: null,
    timezone: null, roles: ["student"], onboardingCompleted: false,
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function fillWizardAndFinish(goalKey: string) {
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "patrick" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText(goalKey));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    });
  }

  it.each([
    ["sem linha", null],
    ["linha recem-criada", freshRow],
  ])("new learner (%s) finishes the signup and goes to /learn", async (_caso, profile) => {
    mocks.getUserProfile.mockResolvedValue(profile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    await fillWizardAndFinish("onboarding.goalCareerLabel");

    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", roles: ["student"], acceptTeacherTerms: false,
      identity: { displayName: "Patrick", username: "patrick", bio: "", timezone, goals: ["career_growth"] },
    });
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/learn");
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sem linha", null],
    ["linha recem-criada", freshRow],
  ])("new teacher (%s) finishes the signup and goes to /teach", async (_caso, profile) => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(profile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await fillWizardAndFinish("onboarding.goalTeachLabel");

    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { payoutCountry: "US" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
      identity: { displayName: "Patrick", username: "patrick", bio: "", timezone, goals: ["teach_online"] },
    });
    expect(mocks.updateOnboardingAnswers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.completeUserOnboarding.mock.invocationCallOrder[0]);
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach");
  });

  // Deliberate change, only for the failed-read state: before, "Continue"
  // removed the notice and opened steps 1 and 2 without the profile read.
  it("a read that fails: the notice with \"Try again\", and Continue does not leave step 0", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockRejectedValue(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(screen.getByRole("button", { name: "onboarding.continue" })).toBeEnabled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expect(pathButton("onboarding.pathTeachTitle")).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
  });
});

describe("OnboardingChoice: \"Try again\" for the profile read", () => {
  const activation = new URLSearchParams("path=teacher");

  // The screen a clean load leaves, to compare with the one that comes out of "Try again".
  async function cleanLoad(profile: unknown) {
    mocks.getUserProfile.mockResolvedValueOnce(profile);
    const { container } = mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    const html = container.children[1].outerHTML;
    const heading = screen.getByRole("heading", { level: 1 }).textContent;
    cleanup();
    vi.clearAllMocks();
    mocks.listeners = [];
    return { html, heading };
  }

  async function failFirstRead() {
    let resolve!: (profile: unknown) => void;
    let reject!: (reason: unknown) => void;
    mocks.getUserProfile
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const view = mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    return { ...view, resolve, reject };
  }

  it("re-reads only the profile, once, without writing or resubscribing, and reaches the screen of a clean load", async () => {
    mocks.searchParams = activation;
    const clean = await cleanLoad(learnerProfile);

    const { container, resolve } = await failFirstRead();
    const heading = screen.getByRole("heading", { level: 1 });
    const retry = screen.getByRole("button", { name: "appErrors.retry" });
    // Both clicks before the screen redraws (the button is still there): what
    // holds the second one is the lock in LoadErrorAlert itself, not the button vanishing.
    act(() => {
      retry.click();
      retry.click();
    });

    // The entry wait: nothing to activate, and focus on the title, which stays.
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(heading).toHaveFocus();
    expectOnlyTheRead(2);

    await act(async () => resolve(learnerProfile));
    expect(container.children[1].outerHTML).toBe(clean.html);
    expect(heading).toHaveTextContent(clean.heading ?? "");
    expect(heading).toHaveFocus();
    expectOnlyTheRead(2);
    expect(mocks.router.push).not.toHaveBeenCalled();

    // The "seed once" lock still holds after "Try again".
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expectOnlyTheRead(2);
  });

  it("in the 3-step signup too: the same screen as a clean load", async () => {
    mocks.searchParams = activation;
    const clean = await cleanLoad(null);
    const { container, resolve } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => resolve(null));
    expect(container.children[1].outerHTML).toBe(clean.html);
    expectOnlyTheRead(2);
  });

  it("after a \"Try again\" that works, the signup finishes and writes once", async () => {
    mocks.searchParams = activation;
    const { resolve } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => resolve(null));

    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "patrick" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText("onboarding.goalTeachLabel"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    });

    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { payoutCountry: "US" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
    }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach");
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
  });

  it("on an account switch \"Try again\" does not read the previous account id", async () => {
    mocks.searchParams = activation;
    const { reject } = await failFirstRead();
    // The session switches account: first "loading", then the other person.
    await act(async () => emit({ status: "loading", user: null }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    });
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");

    // The new account is read by the switch itself, with its own id. If that read
    // fails, "Try again" re-reads the new account.
    await act(async () => emit({ status: "authenticated", user: { ...authedUser, uid: "learner-2" } }));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    await act(async () => reject(new Error("offline")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    });
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(3);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
  });

  it("a re-read that fails again: the notice comes back, with the button", async () => {
    mocks.searchParams = activation;
    const { reject } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expectOnlyTheRead(2);
  });

  it("a late response from \"Try again\" does not overwrite a newer read", async () => {
    mocks.searchParams = activation;
    const { resolve, rerender } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));

    // While "Try again" waits, the address changes path: the session is
    // resubscribed (as today) and reads again. That read is the newest one.
    mocks.getUserProfile.mockResolvedValueOnce(null);
    mocks.searchParams = new URLSearchParams("path=student");
    rerender(
      <PageHeadingProvider>
        <h1><PageHeadingText part="title" fallback="page.title" /></h1>
        <OnboardingChoice />
      </PageHeadingProvider>,
    );
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);

    await act(async () => resolve(learnerProfile));
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);
    expect(screen.queryByRole("button", { name: "onboarding.activateTeaching" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
  });

  it("a following read that works clears the read notice that was left", async () => {
    mocks.searchParams = activation;
    const { rerender } = await failFirstRead();
    mocks.getUserProfile.mockReset();
    mocks.getUserProfile.mockResolvedValueOnce(null);
    mocks.searchParams = new URLSearchParams("path=student");
    rerender(
      <PageHeadingProvider>
        <h1><PageHeadingText part="title" fallback="page.title" /></h1>
        <OnboardingChoice />
      </PageHeadingProvider>,
    );
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "appErrors.retry" })).toBeNull();
  });

  it("\"Try again\" that fails again: Continue does not advance and nothing is written", async () => {
    mocks.searchParams = activation;
    const { reject } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");

    fireEvent.click(pathButton("onboarding.pathTeachTitle"));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));

    // Stays on step 0: without the step 1 fields and without the "Finish" of step 2.
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(screen.queryByRole("button", { name: "onboarding.finishSetup" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expectOnlyTheRead(2);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("an error that is not a read error does not get \"Try again\": what takes the notice place", async () => {
    mocks.searchParams = activation;
    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    mocks.sendSkillsetEmailVerification.mockRejectedValueOnce(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: { ...authedUser, emailVerified: false } }));
    fireEvent.click(pathButton("onboarding.pathTeachTitle"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.sendVerification" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.verificationSendError");
    expect(screen.queryByRole("button", { name: "appErrors.retry" })).toBeNull();

    // Without the profile read, Continue brings back the read notice, with the button.
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
  });

  it("an error that is not a read error does not get \"Try again\": activation that fails", async () => {
    mocks.searchParams = activation;
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile);
    mocks.updateOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorFinish");
    expect(screen.queryByRole("button", { name: "appErrors.retry" })).toBeNull();
  });
});

describe("OnboardingChoice: account switched in another tab", () => {
  // Signed out and signed in with another account in another tab, with this screen open: the same
  // subscription receives "loading" and then the other person.
  const otherUser = { uid: "learner-2", displayName: "Bea", emailVerified: true };
  const otherProfile = {
    ...learnerProfile, displayName: "Bea Lima", username: "bea", bio: "Designer",
    timezone: "Europe/London", goals: ["build_community"],
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function switchAccount() {
    await act(async () => emit({ status: "loading", user: null }));
    await act(async () => emit({ status: "authenticated", user: otherUser }));
  }

  // Reads only: no writes, no navigation, no new subscription.
  function expectNoWrites() {
    expect(mocks.listenToAuthState).toHaveBeenCalledTimes(1);
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
    expect(mocks.refreshUser).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
  }

  it("re-reads the new account profile once and goes back to step 0 with its values", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile).mockResolvedValueOnce(otherProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.bioPlaceholder"), {
      target: { value: "Bio digitada na conta anterior" },
    });

    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    expect(screen.getByText("onboarding.stepPath")).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);

    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Bea Lima");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("bea");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toHaveValue("Designer");
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue("Europe/London");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(pathButton("onboarding.goalCommunityLabel")).toHaveClass(selected);
    expect(pathButton("onboarding.goalCareerLabel")).not.toHaveClass(selected);
    expectNoWrites();
  });

  it("from one account's short activation to a new account with no profile: the clean signup", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile).mockResolvedValueOnce(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));

    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    // The screen of a new teacher on a clean load: the 3-step signup.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(screen.queryByRole("button", { name: "onboarding.activateTeaching" })).toBeNull();
    expect(pathButton("onboarding.pathTeachTitle")).toHaveClass(selected);
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Bea");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toHaveValue("");
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue(timezone);
    expectNoWrites();
  });

  it("after the switch, finishing writes to the new account with only its own values", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValueOnce(teacherProfile).mockResolvedValueOnce(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    // The previous account had a country, accepted terms and saved answers.
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("US");

    await switchAccount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "bea" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText("onboarding.goalTeachLabel"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    });

    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-2", answers: { payoutCountry: "CA" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-2", roles: ["teacher"], acceptTeacherTerms: true,
      identity: { displayName: "Bea", username: "bea", bio: "", timezone, goals: ["teach_online"] },
    });
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach");
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
  });

  // Without answersLoaded going back to false on the switch, the "profile read" of the
  // previous account would let Continue and Finish go through and write over the
  // saved answers of the new account.
  it("a read of the new account that fails: Continue does not leave step 0 or write", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile).mockRejectedValueOnce(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");

    fireEvent.click(pathButton("onboarding.pathTeachTitle"));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));

    // Stays on step 0: without the step 1 fields and without the "Finish" of step 2.
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(screen.queryByRole("button", { name: "onboarding.finishSetup" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expectNoWrites();
  });

  it("the same account again, with \"loading\" in between: does not re-read or erase what was typed", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    const bio = screen.getByPlaceholderText("onboarding.bioPlaceholder");
    fireEvent.change(bio, { target: { value: "Bio digitada agora" } });

    await act(async () => emit({ status: "loading", user: null }));
    await act(async () => {
      emit({ status: "authenticated", user: authedUser });
      emit({ status: "authenticated", user: { ...authedUser, displayName: "Outro" } });
    });
    expectOnlyTheRead(1);
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toBe(bio);
    expect(bio).toHaveValue("Bio digitada agora");
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Patrick Simon");
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("signing out without signing in with another account: goes to /login as today; the same account later does not re-read", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    await act(async () => emit({ status: "unauthenticated", user: null }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/login");
    expectOnlyTheRead(1);

    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expectOnlyTheRead(1);
    expect(mocks.router.push).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["antes", true],
    ["depois", false],
  ])("a switch with the previous account read still in flight: its response, arriving %s the new one, is ignored", async (_quando, previousFirst) => {
    let resolvePrevious!: (profile: unknown) => void;
    let resolveNext!: (profile: unknown) => void;
    mocks.getUserProfile
      .mockReturnValueOnce(new Promise((done) => { resolvePrevious = done; }))
      .mockReturnValueOnce(new Promise((done) => { resolveNext = done; }));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenNthCalledWith(1, "learner-1");
    expect(mocks.getUserProfile).toHaveBeenNthCalledWith(2, "learner-2");

    if (previousFirst) {
      // The previous account's response does not take the screen out of the wait.
      await act(async () => resolvePrevious(learnerProfile));
      expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    }
    await act(async () => resolveNext(otherProfile));
    if (!previousFirst) await act(async () => resolvePrevious(learnerProfile));

    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Bea Lima");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("bea");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toHaveValue("Designer");
    expectNoWrites();
  });
});
