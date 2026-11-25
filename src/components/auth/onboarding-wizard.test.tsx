import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVisibleQuestions, OnboardingWizard } from "@/components/auth/onboarding-wizard";
import type { SkillsetUser } from "@/domain/auth";

/**
 * The first step after confirming the email and introducing yourself: name
 * (prefilled from signup) and phone — which was never asked for anywhere
 * before. Only then comes "how will you use SkillsetMind".
 */

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  // Stable object: a new one per render resubscribes effects and loops.
  auth: {
    status: "authenticated",
    user: { uid: "u-1", email: "preston@example.com", displayName: "Preston Sloan", roles: ["student"] } as
      Pick<SkillsetUser, "uid" | "email" | "displayName" | "roles"> | null,
  },
  profile: {
    displayName: "Preston Sloan",
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

beforeEach(() => {
  mocks.auth = {
    status: "authenticated",
    user: { uid: "u-1", email: "preston@example.com", displayName: "Preston Sloan", roles: ["student"] },
  };
});

describe("welcome: the profile step comes first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.profile = { displayName: "Preston Sloan", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("teacher: opens asking for name (already filled in) and phone; without a phone it does not pass", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    render(<OnboardingWizard />);

    expect(await screen.findByText("First, tell us who you are.")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Preston Sloan");
    expect(screen.getByLabelText("Phone")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("learner: the phone is optional — empty passes, and nothing is invented in the profile", async () => {
    mocks.searchParams = new URLSearchParams("path=student");
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(mocks.updateUserIdentity).toHaveBeenCalledWith("u-1", {
        displayName: "Preston Sloan",
        phoneNumber: null,
      }),
    );
    // The role already came from signup (?path=): does not ask again.
    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("a learner who types a malformed phone does not pass with it", async () => {
    mocks.searchParams = new URLSearchParams("path=student");
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
  });

  it("with name and phone: writes to the profile, marks the step and moves on to the next", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+55 (16) 99999-1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(mocks.updateUserIdentity).toHaveBeenCalledWith("u-1", {
        displayName: "Preston Sloan",
        phoneNumber: "+55 (16) 99999-1234",
      }),
    );
    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ uid: "u-1", answers: expect.objectContaining({ profileConfirmed: true }) }),
      ),
    );
    expect(await screen.findByText("What best describes your work?")).toBeInTheDocument();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("whoever arrived with the wrong role in the link goes back a step and switches", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: { profileConfirmed: true, path: "teacher" },
    };
    render(<OnboardingWizard />);
    await screen.findByText("What best describes your work?");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I want to learn/ }));

    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ path: "student" }),
      ),
    );
    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
  });

  it("with no role defined (neither in the link nor saved), it still asks for the path", async () => {
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();
  });

  it("whoever already introduced themselves does not see the step again when going back", async () => {
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+55 16 99999-1234",
      onboardingAnswers: { profileConfirmed: true },
    };
    render(<OnboardingWizard />);

    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();
    expect(screen.queryByText("First, tell us who you are.")).toBeNull();
  });
});

// The other half of the "back to the course" bug: even carrying the address
// this far, the end of onboarding always dumped the person on /learn. The course
// they were about to buy vanished on the last step.
describe("welcome: the end takes the person back to where they were", () => {
  const studentAnswers = {
    profileConfirmed: true,
    path: "student",
    primaryGoal: ["Business"],
    sourceOfDiscovery: "Instagram",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: studentAnswers,
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  // The learner's last step; from here "Continue" ends onboarding.
  async function terminar() {
    render(<OnboardingWizard />);
    expect(
      await screen.findByText("Where did you hear about SkillsetMind?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("goes back to the course when the person came from one", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=/courses/focus");

    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/courses/focus"),
      { timeout: 4000 },
    );
  });

  it("without a destination, ends where it always ended", async () => {
    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });

  it("a name with $& in the 'You're all set' appears literally, without turning into '{name}'", async () => {
    // In a replace without a callback, "$&" becomes the matched piece ("{name}") and "$'" the
    // rest of the sentence. The name comes from signup: it is the person's text, not ours.
    mocks.auth = {
      status: "authenticated",
      user: { uid: "u-1", email: "preston@example.com", displayName: "Mc$&Donald Stone", roles: ["student"] },
    };

    await terminar();

    expect(
      await screen.findByRole("heading", { level: 1, name: /all set/ }),
    ).toHaveTextContent("You're all set, Mc$&Donald.");
    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });

  // O-18/F-10: the "You're all set" held the person for 1.8s with no button.
  // Now "Continue" arrives focused and goes right away to the SAME destination, and the
  // automatic pause (1500ms) does not navigate a second time after the click.
  it("'Continue' at the end arrives focused and goes right away to the same destination, only once", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=/courses/focus");

    await terminar();

    await screen.findByRole("heading", { level: 1, name: /all set/ });
    const continuar = screen.getByRole("button", { name: "Continue" });
    expect(continuar).toHaveFocus();
    // The screen reader hears the title and the sentence along with the focused button.
    expect(continuar).toHaveAccessibleDescription(/You're all set, Preston\..*Taking you there now\./);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    fireEvent.click(continuar);
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/courses/focus");

    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
  });

  it("without a click, moves on by itself after 1500ms, not before", async () => {
    await terminar();

    await screen.findByRole("heading", { level: 1, name: /all set/ });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mocks.router.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/learn"), { timeout: 2000 });
  });

  // Browser Back during the pause unmounts the screen: the pause still
  // running must not pull the person forward again.
  it("unmounted before the end of the pause, does not navigate", async () => {
    await terminar();
    await screen.findByRole("heading", { level: 1, name: /all set/ });

    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("discards a destination on another domain", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=https://other.com/taken");

    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });

  // The teacher is the exception on purpose: /onboarding?path=teacher is a required
  // account step, not a destination that can be swapped for a link.
  it("a teacher still goes to the teacher signup, with or without a destination", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher&returnTo=/courses/focus");
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true,
        path: "teacher",
        profession: "Coach",
        primaryGoal: ["Business"],
        alreadySold: "no",
        payoutCountry: "US",
        audienceSize: "100,000+ followers",
        instagramHandle: "preston",
      },
    };

    render(<OnboardingWizard />);
    expect(await screen.findByText(/Instagram handle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith("/onboarding?path=teacher"),
      { timeout: 4000 },
    );
  });

  // The only thing that goes with the teacher to /onboarding is the plan they
  // chose on /pricing: there, the last button opens that plan's card screen.
  const card = "/account/billing/upgrade?plan=pro&cycle=monthly";

  it("a teacher who chose a plan on /pricing carries the plan to the teacher signup", async () => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: card });
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true,
        path: "teacher",
        profession: "Coach",
        primaryGoal: ["Business"],
        alreadySold: "no",
        payoutCountry: "US",
        audienceSize: "100,000+ followers",
        instagramHandle: "preston",
      },
    };

    render(<OnboardingWizard />);
    expect(await screen.findByText(/Instagram handle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith(
          "/onboarding?path=teacher&returnTo=%2Faccount%2Fbilling%2Fupgrade%3Fplan%3Dpro%26cycle%3Dmonthly",
        ),
      { timeout: 4000 },
    );
  });

  // A plan belongs to those who teach: whoever finished as a learner does not land on the card screen.
  it("a learner with a plan in the address ends on /learn, not on the card screen", async () => {
    mocks.searchParams = new URLSearchParams({ returnTo: card });

    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });
});

// Only the learner path used to ask "where did you hear about SkillsetMind"; the teacher
// — who matters most to know — never. Same question, optional, same place.
describe("welcome: the teacher also says where they heard about us", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true,
        path: "teacher",
        profession: "Coach",
        primaryGoal: ["Business"],
        alreadySold: "no",
        payoutCountry: "US",
      },
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("asks it as an optional step and saves it with the other answers", async () => {
    render(<OnboardingWizard />);
    await screen.findByText(/Instagram handle/);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("Where did you hear about SkillsetMind?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Podcast" }));

    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: "u-1",
          path: "teacher",
          answers: expect.objectContaining({ path: "teacher", sourceOfDiscovery: "Podcast" }),
        }),
      ),
    );
  });
});

// O-07/O-08/O-21: the interview total shows and is announced; each question
// remounts (the animated entrance runs on all of them); Enter on a button belongs to the button and Esc
// does not go back a question.
describe("welcome: progress, question change and keyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: { profileConfirmed: true, path: "teacher" },
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("shows 'Question 2 of 8' and exposes the progress bar", async () => {
    render(<OnboardingWizard />);
    await screen.findByText("What best describes your work?");

    expect(screen.getByText("Question 2 of 8")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Question 2 of 8" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
  });

  it("each new question is a new element (the entrance runs again)", async () => {
    const view = render(<OnboardingWizard />);
    await screen.findByText("What best describes your work?");
    const first = view.container.querySelector(".welcome-question");

    fireEvent.click(screen.getByRole("button", { name: "Coach" }));
    await screen.findByText("What kind of program will you publish?");

    expect(view.container.querySelector(".welcome-question")).not.toBe(first);
    expect(screen.getByText("Question 3 of 8")).toBeInTheDocument();
  });

  it("Enter on an option does not try to continue and Esc does not go back", async () => {
    render(<OnboardingWizard />);
    const coach = await screen.findByRole("button", { name: "Coach" });

    fireEvent.keyDown(coach, { key: "Enter" });
    expect(screen.queryByText("Answer this question before continuing.")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("What best describes your work?")).toBeInTheDocument();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("Enter in a text field still moves forward", async () => {
    mocks.profile = { displayName: "Preston Sloan", phoneNumber: null, onboardingAnswers: {} };
    render(<OnboardingWizard />);
    const phone = await screen.findByLabelText("Phone");

    fireEvent.keyDown(phone, { key: "Enter" });
    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
  });

  // On the phone the Continue bar stays pinned at the bottom: the notice has to come
  // to the middle of the screen, otherwise it is born behind it and the tap seems to do nothing.
  it("scrolls the error notice into view when it appears", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      mocks.profile = { displayName: "Preston Sloan", phoneNumber: null, onboardingAnswers: {} };
      render(<OnboardingWizard />);
      await screen.findByLabelText("Phone");

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/Enter a phone number/);
      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
      // The box that scrolls is the one outside the notice (InlineAlert does not forward a ref).
      expect(scrollIntoView.mock.contexts).toContain(alert.parentElement);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  // Two quick taps on the same option (or Enter twice) used to advance two
  // questions and skip the topics one, which is required.
  it("two quick taps on an option advance only one question", async () => {
    render(<OnboardingWizard />);
    const coach = await screen.findByRole("button", { name: "Coach" });

    fireEvent.click(coach);
    fireEvent.click(screen.getByRole("button", { name: "Coach" }));

    expect(await screen.findByText("What kind of program will you publish?")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByText("What kind of program will you publish?")).toBeInTheDocument();
    expect(screen.queryByText("Are you already selling online?")).toBeNull();
    expect(screen.getByText("Question 3 of 8")).toBeInTheDocument();
  });

  it("focus goes to the new question title, but not on arrival", async () => {
    render(<OnboardingWizard />);
    const title = await screen.findByRole("heading", { level: 1, name: "What best describes your work?" });
    expect(title).not.toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Coach" }));

    const next = await screen.findByRole("heading", { level: 1, name: "What kind of program will you publish?" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(next).toHaveAttribute("tabindex", "-1");
  });

  it("the selected answer stays selected for the screen reader", async () => {
    mocks.profile.onboardingAnswers = { profileConfirmed: true, path: "teacher", profession: "Coach" };
    render(<OnboardingWizard />);
    await screen.findByText("What kind of program will you publish?");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("button", { name: "Coach" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Facilitator" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("welcome: resumes checkout after losing the session", () => {
  const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: checkout });
    mocks.profile = { displayName: "Preston Sloan", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it.each([
    [checkout, checkout],
    ["//outside.example/checkout", null],
  ])("preserves only a safe destination when entering without a session: %s", async (returnTo, expected) => {
    mocks.auth = { status: "unauthenticated", user: null };
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: returnTo! });
    render(<OnboardingWizard />);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledTimes(1));
    const destination = new URL(mocks.router.replace.mock.calls[0][0], "https://skillsetmind.example");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("mode")).toBe("signin");
    expect(destination.searchParams.get("path")).toBe("teacher");
    expect(destination.searchParams.get("returnTo")).toBe(expected);
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });

  it.each(["profile", "completion"])("preserves checkout when the session disappears before %s", async (step) => {
    if (step === "completion") {
      mocks.profile.onboardingAnswers = {
        profileConfirmed: true,
        path: "student",
        primaryGoal: ["Business"],
        sourceOfDiscovery: "Instagram",
      };
    }
    const view = render(<OnboardingWizard />);
    await screen.findByText(step === "profile"
      ? "First, tell us who you are."
      : "Where did you hear about SkillsetMind?");

    mocks.auth = { status: "unauthenticated", user: null };
    view.rerender(<OnboardingWizard />);
    // The auth effect already redirected. Clear only that observation so the
    // submit guard must preserve the destination independently, before any write.
    mocks.router.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    const destination = new URL(mocks.router.replace.mock.calls[0][0], "https://skillsetmind.example");
    expect(destination.searchParams.get("mode")).toBe("signin");
    expect(destination.searchParams.get("path")).toBe("student");
    expect(destination.searchParams.get("returnTo")).toBe(checkout);
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });
});

describe("H3: the teacher's declared country", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true, path: "teacher", profession: "Coach",
        primaryGoal: ["Business"], alreadySold: "no",
      },
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("requires a choice without inferring the country from the language or the phone", async () => {
    render(<OnboardingWizard />);
    expect(await screen.findByLabelText("Country of your bank account")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Answer this question before continuing.")).toBeInTheDocument();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });

  it.each(["CA", "other"])("persists %s only in the answers, keeps the previous ones and resumes without losing the country", async (country) => {
    const view = render(<OnboardingWizard />);
    fireEvent.change(await screen.findByLabelText("Country of your bank account"), { target: { value: country } });
    if (country === "other") {
      expect(screen.getByRole("status")).toHaveTextContent(/cannot sell or receive payments/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Do you already have an audience?");
    expect(mocks.updateOnboardingAnswers).toHaveBeenLastCalledWith({
      uid: "u-1", path: "teacher", completed: false,
      answers: { ...mocks.profile.onboardingAnswers, payoutCountry: country },
    });
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    mocks.profile.onboardingAnswers = mocks.updateOnboardingAnswers.mock.calls.at(-1)![0].answers;
    view.unmount();
    render(<OnboardingWizard />);
    await screen.findByText(/Instagram handle/);
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    }
    expect(screen.getByLabelText("Country of your bank account")).toHaveValue(country);
  });

  it("does not advance when persistence fails and allows trying again", async () => {
    mocks.updateOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    render(<OnboardingWizard />);
    fireEvent.change(await screen.findByLabelText("Country of your bank account"), { target: { value: "GB" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Could not save this answer/)).toBeInTheDocument();
    expect(screen.getByLabelText("Country of your bank account")).toHaveValue("GB");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Do you already have an audience?");
  });

  it("a learner does not get the question even with an old declaration", async () => {
    mocks.profile.onboardingAnswers = { profileConfirmed: true, path: "student", payoutCountry: "other" };
    render(<OnboardingWizard />);
    await screen.findByText("What do you want to learn first?");
    expect(screen.queryByLabelText("Country of your bank account")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Personal Development" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Where did you hear about SkillsetMind?");
    expect(screen.queryByLabelText("Country of your bank account")).toBeNull();
  });

  it("switching from learner to teacher starts requiring the question", async () => {
    mocks.searchParams = new URLSearchParams();
    mocks.profile.onboardingAnswers = { profileConfirmed: true, primaryGoal: ["Business"], profession: "Coach", alreadySold: "no" };
    render(<OnboardingWizard />);
    fireEvent.click(await screen.findByRole("button", { name: /I want to teach/ }));
    await screen.findByText("What best describes your work?");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Country of your bank account")).toHaveValue("");
  });

  it("Enter on the selector neither saves nor advances before confirming the choice", async () => {
    render(<OnboardingWizard />);
    const select = await screen.findByLabelText("Country of your bank account");
    fireEvent.change(select, { target: { value: "CA" } });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(screen.getByLabelText("Country of your bank account")).toHaveValue("CA");
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });
});

// O-09: whoever created the account in the middle of a purchase is going to pay, not answer
// "what do you want to learn". With a destination, the learner's interest becomes optional; without a
// destination, and for the teacher in any case, nothing changes.
describe("welcome: the buyer goes on to checkout without answering the interest question", () => {
  const checkout = "/courses/focus/checkout?offer=LAUNCH";
  const plano = "/account/billing/upgrade?plan=pro&cycle=monthly";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = { displayName: "Preston Sloan", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("a learner coming from checkout can skip the interest and ends at checkout", async () => {
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: checkout });
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Where did you hear about SkillsetMind?")).toBeInTheDocument();
    expect(screen.queryByText("Answer this question before continuing.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith(checkout),
      { timeout: 4000 },
    );
  });

  // The /pricing plan is not a destination for the learner (they end on /learn):
  // the interest stays required, as today.
  it.each([
    ["without a destination", null],
    ["with the /pricing plan", plano],
  ])("learner %s still has to answer the interest question", async (_label, returnTo) => {
    mocks.searchParams = new URLSearchParams({ path: "student", ...(returnTo ? { returnTo } : {}) });
    mocks.profile.onboardingAnswers = { profileConfirmed: true, path: "student" };
    render(<OnboardingWizard />);

    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Answer this question before continuing.")).toBeInTheDocument();
    expect(screen.queryByText("Where did you hear about SkillsetMind?")).toBeNull();
  });

  it.each([
    ["without a destination", null],
    ["with a course checkout", checkout],
    ["with the /pricing plan", plano],
  ])("teacher %s: the program question stays required, in the same position", async (_label, returnTo) => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", ...(returnTo ? { returnTo } : {}) });
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: { profileConfirmed: true, path: "teacher", profession: "Coach" },
    };
    render(<OnboardingWizard />);

    expect(await screen.findByText("What kind of program will you publish?")).toBeInTheDocument();
    expect(screen.getByText("Question 3 of 8")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Answer this question before continuing.")).toBeInTheDocument();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });

  it.each([false, true])("teacher branch identical with and without a destination (role already known: %s)", (pathKnown) => {
    for (const alreadySold of [undefined, "no", "yes"] as const) {
      const answers = { path: "teacher" as const, alreadySold };
      expect(getVisibleQuestions(answers, pathKnown, true)).toEqual(getVisibleQuestions(answers, pathKnown, false));
    }
  });

  it("learner branch: with a destination, only the interest changes, and only from required to optional", () => {
    const withoutDestination = getVisibleQuestions({ path: "student" }, true, false);
    const withDestination = getVisibleQuestions({ path: "student" }, true, true);

    expect(withoutDestination.find((question) => question.id === "primaryGoal")?.required).toBe(true);
    expect(withDestination).toEqual(
      withoutDestination.map((question) => (question.id === "primaryGoal" ? { ...question, required: false } : question)),
    );
  });
});

// F-09: the interview dots became the house bar (the classroom one and the
// builder one). What the screen reader hears (the step, from 1 to the total, and
// "Question N of M") and the visible sentence stay the same on the first, a middle
// and the last step of both paths.
describe("F-09: the interview bar is the house bar, with the same values", () => {
  const completeTeacher = {
    profileConfirmed: true,
    path: "teacher",
    profession: "Coach",
    primaryGoal: ["Business"],
    alreadySold: "no",
    payoutCountry: "US",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it.each([
    ["learner, first step", "student", {}, 1, 3, "First, tell us who you are."],
    ["learner, middle step", "student", { profileConfirmed: true, path: "student" }, 2, 3, "What do you want to learn first?"],
    ["learner, last step", "student", { profileConfirmed: true, path: "student", primaryGoal: ["Business"] }, 3, 3, "Where did you hear about SkillsetMind?"],
    ["teacher, first step", "teacher", {}, 1, 8, "First, tell us who you are."],
    ["teacher, middle step", "teacher", { profileConfirmed: true, path: "teacher", profession: "Coach" }, 3, 8, "What kind of program will you publish?"],
    ["teacher, last step", "teacher", completeTeacher, 8, 8, /Instagram handle/],
  ])("%s: Question N of M in the sentence and in the bar", async (_label, path, answers, current, total, title) => {
    mocks.searchParams = new URLSearchParams({ path });
    mocks.profile = { displayName: "Preston Sloan", phoneNumber: "+1 555 123 4567", onboardingAnswers: { ...answers } };
    render(<OnboardingWizard />);
    expect(await screen.findByText(title)).toBeInTheDocument();

    const text = `Question ${current} of ${total}`;
    expect(screen.getByText(text)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: text });
    expect(bar).toHaveAttribute("aria-valuenow", String(current));
    expect(bar).toHaveAttribute("aria-valuemin", "1");
    expect(bar).toHaveAttribute("aria-valuemax", String(total));
    expect(bar).toHaveAttribute("aria-valuetext", text);
    // The design is ProgressBar's: a track that follows the theme, brass text.
    expect(bar).toHaveClass("h-1.5", "rounded-full", "bg-[var(--color-line)]");
    expect(bar.firstElementChild).toHaveClass("bg-[var(--color-accent-fg)]");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  // The question list, the order and the required flag of each one, written out here
  // in full: the bundle only changed the bar design.
  it("the questions, the order and the required flag of each path stay the same", () => {
    const visibleQuestions = (...args: Parameters<typeof getVisibleQuestions>) =>
      getVisibleQuestions(...args).map(({ number, id, required }) => `${number}:${id}:${required ? "obrigatória" : "opcional"}`);

    expect(visibleQuestions({ path: "student" }, true, false)).toEqual([
      "1:profile:obrigatória",
      "2:primaryGoal:obrigatória",
      "3:sourceOfDiscovery:opcional",
    ]);
    expect(visibleQuestions({ path: "student" }, true, true)).toEqual([
      "1:profile:obrigatória",
      "2:primaryGoal:opcional",
      "3:sourceOfDiscovery:opcional",
    ]);
    expect(visibleQuestions({ path: "teacher", alreadySold: "no" }, true, false)).toEqual([
      "1:profile:obrigatória",
      "2:profession:obrigatória",
      "3:primaryGoal:obrigatória",
      "4:alreadySold:obrigatória",
      "5:payoutCountry:obrigatória",
      "6:audienceSize:opcional",
      "7:sourceOfDiscovery:opcional",
      "8:instagramHandle:opcional",
    ]);
    expect(visibleQuestions({ path: "teacher", alreadySold: "yes" }, false, true)).toEqual([
      "1:profile:obrigatória",
      "2:path:obrigatória",
      "3:profession:obrigatória",
      "4:primaryGoal:obrigatória",
      "5:alreadySold:obrigatória",
      "6:payoutCountry:obrigatória",
      "7:monthlyRevenue:opcional",
      "8:audienceSize:opcional",
      "9:sourceOfDiscovery:opcional",
      "10:instagramHandle:opcional",
    ]);
  });
});

// F-04: the waiting "Continue" does not change width (and does not push "Skip").
// F-11: the read of saved answers that fails on arrival gets "Try again";
// save failures do not (repeating there is "Continue" itself).
describe("welcome: 'Continue' waiting and the read that failed on arrival", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=student");
    mocks.profile = { displayName: "Preston Sloan", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("'Continue' waiting: name 'Saving...', lock, and both labels in the same cell", async () => {
    let release!: () => void;
    mocks.updateUserIdentity.mockReturnValue(new Promise<void>((resolve) => { release = () => resolve(); }));
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveAttribute("type", "button");
    expect(within(button).getByText("Saving...")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(button);
    expect(button).toHaveAccessibleName("Saving...");
    expect(button).toBeDisabled();
    const idle = within(button).getByText("Continue");
    expect(idle).toHaveAttribute("aria-hidden", "true");
    expect(idle.parentElement).toBe(within(button).getByText("Saving...").parentElement);

    await act(async () => release());
    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(mocks.updateUserIdentity).toHaveBeenCalledTimes(1);
  });

  it("the read failed on arrival: 'Try again' repeats the read once and resumes where the person left off", async () => {
    mocks.profile = {
      displayName: "Preston Sloan",
      phoneNumber: null,
      onboardingAnswers: { profileConfirmed: true, path: "student" },
    };
    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    render(<OnboardingWizard />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load saved onboarding answers. You can continue from here.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    // Read only: nothing was written along the way.
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
  });

  // The "Try again" wait does not have the saved answers yet: an Enter there
  // would write the old state (typed name, empty answers) over them.
  it("Enter during the 'Try again' wait writes nothing; with the interview back, focus goes to the title and Enter proceeds", async () => {
    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    render(<OnboardingWizard />);
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Preston Sloan" } });

    let finishRead!: () => void;
    mocks.getUserProfile.mockReturnValueOnce(new Promise((resolve) => { finishRead = () => resolve(mocks.profile); }));
    const retry = screen.getByRole("button", { name: "Try again" });
    retry.focus();
    // Enter on a button belongs to the button itself: the browser turns it into a click.
    fireEvent.keyDown(retry, { key: "Enter" });
    fireEvent.click(retry);
    expect(await screen.findByText("Opening SkillsetMind...")).toBeInTheDocument();

    // A second Enter (or the key held down) with the read still running.
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    await act(async () => {});
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();

    await act(async () => finishRead());
    const title = await screen.findByText("First, tell us who you are.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(title.closest("#onboarding-question-title"));

    // Back again, Enter proceeds as before.
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(mocks.updateUserIdentity).toHaveBeenCalledTimes(1));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
  });

  it("Enter during the arrival wait neither writes nor leaves a stale notice", async () => {
    let finishRead!: () => void;
    mocks.getUserProfile.mockReturnValueOnce(new Promise((resolve) => { finishRead = () => resolve(mocks.profile); }));
    render(<OnboardingWizard />);
    expect(screen.getByText("Opening SkillsetMind...")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Enter" });
    await act(async () => finishRead());

    expect(await screen.findByText("First, tell us who you are.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });

  it("a save failure does not get 'Try again'", async () => {
    mocks.updateUserIdentity.mockRejectedValueOnce(new Error("offline"));
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });
});
