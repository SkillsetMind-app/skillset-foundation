import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/auth/auth-provider";
import { useLegalGateWaiting } from "@/components/auth/legal-gate-state";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { markSignupTerms, SIGNUP_TERMS_MARK_KEY } from "@/lib/auth/signup-terms-mark";
import {
  currentPrivacyVersion,
  currentTeacherTermsVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";

const mocks = vi.hoisted(() => ({
  pathname: "/learn",
  listenToAuthState: vi.fn(),
  getUserProfile: vi.fn(),
  acceptUserTerms: vi.fn(),
  acceptTeacherTerms: vi.fn(),
  getSignupLegalVersions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: mocks.listenToAuthState,
  signOutOfSkillsetMind: vi.fn(),
  getCurrentAuthSession: vi.fn(),
  getSignupLegalVersions: mocks.getSignupLegalVersions,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  acceptUserTerms: mocks.acceptUserTerms,
  acceptTeacherTerms: mocks.acceptTeacherTerms,
}));

vi.mock("@/lib/posthog/client", () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
}));

const ACCEPT = "Accept and continue";
// A teacher who accepted the May Teacher Terms, older than the current version.
const OUTDATED_TEACHER = { roles: ["teacher"], teacherTermsAcceptedAt: "2026-05-10T00:00:00.000Z", teacherTermsVersion: "2026-05-10" };

// Lets the profile read resolve and the gate render before asserting absence.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// What the welcome tours read to wait for the terms dialog.
function TourWaitProbe() {
  return <span data-testid="tour-waits">{String(useLegalGateWaiting())}</span>;
}
const tourWaits = () => screen.getByTestId("tour-waits").textContent;

function LocaleToggle() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>English</button>;
}

function renderSignedIn(locale: "en" | "es" = "en") {
  mocks.listenToAuthState.mockImplementation(
    (setSession: (next: unknown) => void) => {
      setSession({
        status: "authenticated",
        user: {
          uid: "u-1",
          email: "person@example.com",
          displayName: "Test Person",
          roles: ["student"],
          termsAcceptedVersion: null,
          privacyAcceptedVersion: null,
        },
      });
      return () => {};
    },
  );
  return render(
    <I18nProvider initialLocale={locale}>
      <LocaleToggle />
      <AuthProvider>
        <p>page</p>
        <TourWaitProbe />
      </AuthProvider>
    </I18nProvider>,
  );
}

// The signup form treats its post-signup writes as best-effort and relies on
// this gate to re-collect the terms when one of them failed. These tests pin
// that contract so the recovery path can't silently disappear.
describe("LegalAcceptanceGate as the signup recovery path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.pathname = "/learn";
    mocks.acceptUserTerms.mockResolvedValue(undefined);
    mocks.acceptTeacherTerms.mockResolvedValue(undefined);
    mocks.getSignupLegalVersions.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("translates legal consent and failed feedback without clearing consent on locale change", async () => {
    mocks.getUserProfile.mockResolvedValue({ termsVersion: null, privacyVersion: null, marketingConsent: false });
    mocks.acceptUserTerms.mockRejectedValue(new Error("transport details"));
    renderSignedIn("es");
    const accept = await screen.findByRole("button", { name: "Aceptar y continuar" });
    expect(screen.getByRole("heading", { name: "Revisa los términos de SkillsetMind para continuar." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Condiciones de servicio" }).getAttribute("href")).toBe("/legal/terms");
    expect(screen.getByRole("link", { name: "Política de privacidad" }).getAttribute("href")).toBe("/legal/privacy");
    expect(accept).toHaveProperty("disabled", true);
    const [terms, privacy] = screen.getAllByRole("checkbox");
    fireEvent.click(terms);
    expect(accept).toHaveProperty("disabled", true);
    fireEvent.click(privacy);
    fireEvent.click(accept);
    await screen.findByText("No pudimos guardar tu aceptación. Inténtalo de nuevo.");
    expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false);
    expect(screen.queryByText("transport details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("Could not update your legal acceptance. Please try again.")).toBeTruthy();
    expect(screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: ACCEPT })).toHaveProperty("disabled", false);
  });

  // C-06: the dialog covered the page, but Tab escaped to the page behind and the
  // screen reader did not know it was a dialog. It stays without an exit: Esc does not
  // close it, and focus starts on the first checkbox with nothing checked.
  it("is a real modal: named, focus inside on the first box, Escape does not close it, error announced", async () => {
    mocks.getUserProfile.mockResolvedValue({ termsVersion: null, privacyVersion: null, marketingConsent: false });
    mocks.acceptUserTerms.mockRejectedValue(new Error("transport details"));
    renderSignedIn();

    const dialog = await screen.findByRole("dialog", { name: "Review SkillsetMind terms to continue." });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Focus starts on the checkbox: the explanation comes through the dialog description.
    expect(dialog).toHaveAccessibleDescription("Read and accept the SkillsetMind terms to use your account.");
    const [terms, privacy] = screen.getAllByRole("checkbox");
    await waitFor(() => expect(terms).toHaveFocus());
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((terms as HTMLInputElement).checked).toBe(false);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Review SkillsetMind terms to continue." })).toBe(dialog);
    expect(within(dialog).queryByRole("button", { name: /close/i })).toBeNull();

    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update your legal acceptance. Please try again.");
  });

  // The welcome tours wait for the dialog: with the dialog on screen, and before
  // knowing whether it will show, the value is true; once accepted, it becomes false.
  it("tells the welcome tours to wait while the window is open or still undecided", async () => {
    let resolveProfile!: (profile: unknown) => void;
    mocks.getUserProfile.mockReturnValue(new Promise((done) => { resolveProfile = done; }));
    renderSignedIn();
    expect(tourWaits()).toBe("true");

    await act(async () => resolveProfile({ termsVersion: null, privacyVersion: null, marketingConsent: false }));
    await screen.findByRole("dialog");
    expect(tourWaits()).toBe("true");

    const [terms, privacy] = screen.getAllByRole("checkbox");
    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tourWaits()).toBe("false");
  });

  it("lets the welcome tours open once the terms are known to be current", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      marketingConsent: false,
    });
    renderSignedIn();
    await waitFor(() => expect(tourWaits()).toBe("false"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the terms again when the profile has none and records them", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: null,
      privacyVersion: null,
      marketingConsent: false,
    });
    renderSignedIn();

    const accept = await screen.findByRole("button", { name: ACCEPT });
    const [terms, privacy] = screen.getAllByRole("checkbox");
    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(accept);

    await waitFor(() =>
      expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull(),
    );
  });

  it("stays out of the way on /welcome so onboarding finishes first", async () => {
    mocks.pathname = "/welcome";
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: null,
      privacyVersion: null,
      marketingConsent: false,
    });
    renderSignedIn();

    await waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });

  it("does not interrupt a profile whose terms are current", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      marketingConsent: false,
    });
    renderSignedIn();

    await waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });

  it("asks a teacher to re-accept outdated Teacher Terms, and only those", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      marketingConsent: false,
      ...OUTDATED_TEACHER,
    });
    renderSignedIn();

    const accept = await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByRole("link", { name: "Teacher Terms" }).getAttribute("href")).toBe("/legal/teacher-terms");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(accept).toHaveProperty("disabled", true);
    fireEvent.click(boxes[0]);
    fireEvent.click(accept);

    await waitFor(() => expect(mocks.acceptTeacherTerms).toHaveBeenCalledWith("u-1"));
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull());
  });

  // Accepting the teacher terms means accepting the public profile: the line says
  // what becomes public and where. Only together with the teacher terms.
  it.each([
    ["en", "Your teacher profile (name, photo, bio and credentials) is public at skillsetmind.com/@ana."],
    ["es", "Tu perfil de profesor (nombre, foto, biografía y credenciales) es público en skillsetmind.com/@ana."],
  ] as const)("re-accepting the Teacher Terms says the profile is public (%s)", async (locale, line) => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      marketingConsent: false,
      ...OUTDATED_TEACHER,
      username: "ana",
    });
    renderSignedIn(locale);
    expect(await screen.findByText(line)).toBeTruthy();
  });

  it("general terms alone carry no public-profile line", async () => {
    mocks.getUserProfile.mockResolvedValue({ termsVersion: null, privacyVersion: null, marketingConsent: false });
    renderSignedIn();
    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.queryByText(/is public at/)).toBeNull();
  });

  it("collects all three when both are outdated and keeps the general acceptance when the teacher write fails", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: null,
      privacyVersion: null,
      marketingConsent: false,
      ...OUTDATED_TEACHER,
    });
    mocks.acceptTeacherTerms.mockRejectedValueOnce(new Error("transport details"));
    renderSignedIn();

    const accept = await screen.findByRole("button", { name: ACCEPT });
    const [terms, privacy, teacher] = screen.getAllByRole("checkbox");
    fireEvent.click(terms);
    fireEvent.click(privacy);
    expect(accept).toHaveProperty("disabled", true);
    fireEvent.click(teacher);
    fireEvent.click(accept);

    await screen.findByText("Could not update your legal acceptance. Please try again.");
    expect(mocks.acceptUserTerms).toHaveBeenCalledTimes(1);
    // Only the Teacher Terms are still owed, and the retry stays open.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    await waitFor(() => expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull());
    expect(mocks.acceptUserTerms).toHaveBeenCalledTimes(1);
    expect(mocks.acceptTeacherTerms).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a teacher who never accepted Teacher Terms (onboarding owns that)", { roles: ["teacher"] }],
    ["a learner with an old Teacher Terms stamp", { ...OUTDATED_TEACHER, roles: ["student"] }],
    ["a teacher on the current Teacher Terms", { ...OUTDATED_TEACHER, teacherTermsVersion: currentTeacherTermsVersion }],
  ])("does not interrupt %s", async (_label, extra) => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      marketingConsent: false,
      ...extra,
    });
    renderSignedIn();

    await waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });

  it.each(["/legal/teacher-terms", "/legal/copyright"])("keeps %s readable while a re-acceptance is pending", async (path) => {
    mocks.pathname = path;
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: null,
      privacyVersion: null,
      marketingConsent: false,
      ...OUTDATED_TEACHER,
    });
    renderSignedIn();

    await waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });
});

// Wave F: the terms were asked for twice. The person ticked them at signup, the
// tick was lost on the way through email confirmation, and on arrival came a
// "Legal update" dialog. Now signup stores the accepted versions and this
// gate writes them without asking, with the signup time, but only in the same
// browser as the signup. Outside it the dialog asks once, as a first
// acceptance ("Before you start"), never as an "update".
describe("LegalAcceptanceGate asks only once", () => {
  const OLD = { termsVersion: "2026-04-26", privacyVersion: "2026-05-10" };
  const SIGNED_UP_AT = "2026-10-05T10:00:00Z";
  const TICKED = { terms: currentTermsVersion, privacy: currentPrivacyVersion, acceptedAt: SIGNED_UP_AT };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.pathname = "/learn";
    mocks.acceptUserTerms.mockResolvedValue(undefined);
    mocks.acceptTeacherTerms.mockResolvedValue(undefined);
    mocks.getUserProfile.mockResolvedValue({ termsVersion: null, privacyVersion: null, marketingConsent: false });
    mocks.getSignupLegalVersions.mockResolvedValue(TICKED);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  async function expectFirstAcceptancePrompt() {
    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByText("Before you start")).toBeTruthy();
    expect(screen.queryByText("Legal update")).toBeNull();
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
  }

  it("same browser: stores the signup tick with the signup time, without asking, and clears the mark", async () => {
    markSignupTerms("u-1");
    renderSignedIn();

    await waitFor(() => expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false, SIGNED_UP_AT));
    await settle();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(window.localStorage.getItem(SIGNUP_TERMS_MARK_KEY)).toBeNull();
  });

  it("stores it even when the confirmation lands on /welcome", async () => {
    mocks.pathname = "/welcome";
    markSignupTerms("u-1");
    renderSignedIn();

    await waitFor(() => expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false, SIGNED_UP_AT));
  });

  it("another browser or device: asks once, as a first acceptance, and records the click", async () => {
    renderSignedIn();

    await expectFirstAcceptancePrompt();
    expect(mocks.getSignupLegalVersions).not.toHaveBeenCalled();
    const [terms, privacy] = screen.getAllByRole("checkbox");
    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));

    await waitFor(() => expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull());
    expect(mocks.acceptUserTerms).toHaveBeenCalledTimes(1);
    expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false);
  });

  // Someone signed up my email and ticked the terms. The mark, if it exists, is
  // from the account of whoever signed up in this browser, not mine.
  it("someone else signed up with my email: asks, and leaves their mark alone", async () => {
    markSignupTerms("u-someone-else");
    renderSignedIn();

    await expectFirstAcceptancePrompt();
    expect(window.localStorage.getItem(SIGNUP_TERMS_MARK_KEY)).toContain("u-someone-else");
  });

  it.each([
    ["the mark carries older versions", { uid: "u-1", terms: OLD.termsVersion, privacy: OLD.privacyVersion, expiresAt: Date.now() + 60_000 }, TICKED],
    ["the account carries older versions", null, { ...TICKED, terms: OLD.termsVersion, privacy: OLD.privacyVersion }],
    ["the mark expired", { uid: "u-1", terms: currentTermsVersion, privacy: currentPrivacyVersion, expiresAt: Date.now() - 1 }, TICKED],
  ])("versions changed since signup (%s): asks as a first acceptance", async (_label, mark, signup) => {
    if (mark) window.localStorage.setItem(SIGNUP_TERMS_MARK_KEY, JSON.stringify(mark));
    else markSignupTerms("u-1");
    mocks.getSignupLegalVersions.mockResolvedValue(signup);
    renderSignedIn();

    await expectFirstAcceptancePrompt();
  });

  it("shows the update prompt when the stored version changed", async () => {
    mocks.getUserProfile.mockResolvedValue({ ...OLD, marketingConsent: false });
    markSignupTerms("u-1");
    renderSignedIn();

    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByText("Legal update")).toBeTruthy();
    expect(mocks.getSignupLegalVersions).not.toHaveBeenCalled();
  });

  it("falls back to asking when the signup acceptance cannot be saved", async () => {
    markSignupTerms("u-1");
    mocks.acceptUserTerms.mockRejectedValueOnce(new Error("no row"));
    renderSignedIn();

    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByText("Before you start")).toBeTruthy();
  });
});
