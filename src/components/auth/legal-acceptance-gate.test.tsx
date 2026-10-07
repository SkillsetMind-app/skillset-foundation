import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/auth/auth-provider";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
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

  // Aceitar os termos de professor é aceitar o perfil público: a linha diz o
  // que fica público e onde. Só junto dos termos de professor.
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

// Onda F: os termos eram pedidos duas vezes. A pessoa marcava no cadastro, o
// tique se perdia no caminho da confirmacao do e-mail, e na chegada vinha uma
// janela "Legal update". Agora o cadastro guarda as versoes aceitas e esta
// porta as grava sem perguntar; a janela de "atualizacao" so aparece quando a
// versao aceita ficou para tras.
describe("LegalAcceptanceGate asks only once", () => {
  const OLD = { termsVersion: "2026-04-26", privacyVersion: "2026-05-10" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/learn";
    mocks.acceptUserTerms.mockResolvedValue(undefined);
    mocks.acceptTeacherTerms.mockResolvedValue(undefined);
    mocks.getUserProfile.mockResolvedValue({ termsVersion: null, privacyVersion: null, marketingConsent: false });
    mocks.getSignupLegalVersions.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("stores the terms ticked at signup without asking again", async () => {
    mocks.getSignupLegalVersions.mockResolvedValue({ terms: currentTermsVersion, privacy: currentPrivacyVersion });
    renderSignedIn();

    await waitFor(() => expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false));
    await settle();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(screen.queryByText("Legal update")).toBeNull();
  });

  it("stores it even when the confirmation lands on /welcome", async () => {
    mocks.pathname = "/welcome";
    mocks.getSignupLegalVersions.mockResolvedValue({ terms: currentTermsVersion, privacy: currentPrivacyVersion });
    renderSignedIn();

    await waitFor(() => expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false));
  });

  it("asks again, as an update, when the version accepted at signup is older", async () => {
    mocks.getSignupLegalVersions.mockResolvedValue({ terms: OLD.termsVersion, privacy: OLD.privacyVersion });
    renderSignedIn();

    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByText("Legal update")).toBeTruthy();
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
  });

  it("shows the update prompt when the stored version changed", async () => {
    mocks.getUserProfile.mockResolvedValue({ ...OLD, marketingConsent: false });
    renderSignedIn();

    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByText("Legal update")).toBeTruthy();
    expect(mocks.getSignupLegalVersions).not.toHaveBeenCalled();
  });

  it("never says 'update' to someone who has accepted nothing yet", async () => {
    renderSignedIn();

    await screen.findByRole("button", { name: ACCEPT });
    expect(screen.getByText("Before you start")).toBeTruthy();
    expect(screen.queryByText("Legal update")).toBeNull();
    expect(mocks.acceptUserTerms).not.toHaveBeenCalled();
  });

  it("falls back to asking when the signup acceptance cannot be saved", async () => {
    mocks.getSignupLegalVersions.mockResolvedValue({ terms: currentTermsVersion, privacy: currentPrivacyVersion });
    mocks.acceptUserTerms.mockRejectedValueOnce(new Error("no row"));
    renderSignedIn();

    await screen.findByRole("button", { name: ACCEPT });
  });
});
