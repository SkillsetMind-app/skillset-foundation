import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage } from "@/components/auth/auth-page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AuthSession } from "@/domain/auth";
import type { Locale } from "@/lib/i18n/config";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(),
  auth: { status: "unauthenticated", user: null } as AuthSession,
  googleEnabled: false,
  signInWithGoogle: vi.fn(),
  getPendingSecondFactor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth/providers", () => ({
  // A getter, not a value: the Google flag changes between the cases in this file.
  get isGoogleAuthEnabled() {
    return mocks.googleEnabled;
  },
}));
vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signInWithGoogle: mocks.signInWithGoogle,
  getPendingSecondFactor: mocks.getPendingSecondFactor,
}));
vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn() }));

const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
const checkoutEncoded =
  "%2Fcourses%2Ffocus%2Fcheckout%3Foffer%3DLAUNCH%26priceId%3Dprice-1";

function renderAt(query: string, locale: Locale = "en") {
  mocks.searchParams = new URLSearchParams(query);
  return render(
    <I18nProvider initialLocale={locale}>
      <AuthPage />
    </I18nProvider>,
  );
}

// The screen was already split by role, but the role only showed in a tiny eyebrow
// under a generic title, and there was no way to switch. Whoever came in through the
// wrong door did not notice.
describe("login entry by role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: "unauthenticated", user: null };
    mocks.googleEnabled = false;
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    // The real call navigates away and never resolves.
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
  });

  afterEach(cleanup);

  it.each([
    [
      "mode=signin&path=student",
      "Sign in as a learner.",
      "Entra como estudiante.",
    ],
    [
      "mode=signin&path=teacher",
      "Sign in as a teacher.",
      "Entra como profesor.",
    ],
    [
      "mode=signup&path=student",
      "Create your learner account.",
      "Crea tu cuenta de estudiante.",
    ],
    [
      "mode=signup&path=teacher",
      "Create your teacher account.",
      "Crea tu cuenta de profesor.",
    ],
  ])("the title states the role on %s (EN and ES)", (query, inEnglish, inSpanish) => {
    renderAt(query);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(inEnglish);

    cleanup();
    renderAt(query, "es");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      inSpanish,
    );
  });

  it.each([
    ["student", "teacher", "Are you a teacher? Sign in here"],
    ["teacher", "student", "Are you a learner? Sign in here"],
  ])(
    "from %s offers the switch to %s without losing the captured destination",
    (papel, otherRole, rotulo) => {
      renderAt(`mode=signin&path=${papel}&returnTo=${checkoutEncoded}`);

      const destination = new URL(
        screen.getByRole("link", { name: rotulo }).getAttribute("href")!,
        "https://skillset.test",
      );
      expect(destination.pathname).toBe("/auth");
      expect(destination.searchParams.get("mode")).toBe("signin");
      expect(destination.searchParams.get("path")).toBe(otherRole);
      expect(destination.searchParams.get("returnTo")).toBe(checkout);
    },
  );

  it("hides Google while the provider flag is off", () => {
    renderAt("mode=signin&path=teacher");

    expect(
      screen.queryByRole("button", { name: /Continue with Google/ }),
    ).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
  });

  // The same order as signup: email first, "or", Google last.
  it("with the flag on, Google comes after email and carries role and destination", () => {
    mocks.googleEnabled = true;
    const view = renderAt(`mode=signin&path=teacher&returnTo=${checkoutEncoded}`);

    const google = screen.getByRole("button", { name: /Continue with Google/ });
    const email = view.container.querySelector('input[type="email"]')!;
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(screen.getByText("or")).toBeInTheDocument();
    expect(
      email.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      signIn.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(google);

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      `/loading?next=welcome&path=teacher&returnTo=${checkoutEncoded}`,
    );
  });

  // Only the clicked button says it is working; both stay locked.
  it("clicking Google changes only the Google label and locks both buttons", () => {
    mocks.googleEnabled = true;
    renderAt("mode=signin&path=student");

    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));

    const google = screen.getByRole("button", { name: "Opening Google..." });
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(google).toBeDisabled();
    expect(signIn).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Signing in..." })).toBeNull();
  });
});
