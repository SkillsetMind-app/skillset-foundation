import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage } from "@/components/auth/auth-page";
import { LoadingScreen } from "@/components/auth/loading-screen";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AuthSession, SkillsetUser } from "@/domain/auth";
import { MfaRequiredError } from "@/lib/auth/supabase-auth";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(),
  auth: { status: "unauthenticated", user: null } as AuthSession,
  getUserProfile: vi.fn(),
  getPendingSecondFactor: vi.fn(),
  signInWithEmail: vi.fn(),
  completeMfaSignIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: false }));
vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  getPendingSecondFactor: mocks.getPendingSecondFactor,
  signInWithEmail: mocks.signInWithEmail,
  completeMfaSignIn: mocks.completeMfaSignIn,
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
}));

const sessionUser: SkillsetUser = {
  uid: "entry-user", email: "learner@example.test", emailVerified: true,
  displayName: "Learner", photoURL: null, roles: ["student"],
};
const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
const ROUTED = { timeout: 4000 };

function renderAuth() {
  return render(<I18nProvider initialLocale="en"><AuthPage /></I18nProvider>);
}

async function continueThroughLoading(view: ReturnType<typeof renderAuth>, intent: string) {
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledTimes(1));
  const destination = new URL(mocks.router.replace.mock.calls[0][0], "https://skillsetmind.example");
  expect(destination.pathname).toBe("/loading");
  expect(destination.searchParams.get("next")).toBe("welcome");
  expect(destination.searchParams.get("path")).toBe(intent);
  view.unmount();
  mocks.searchParams = destination.searchParams;
  render(<I18nProvider initialLocale="en"><LoadingScreen /></I18nProvider>);
}

describe("AuthPage continues an existing verified session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: "authenticated", user: sessionUser };
    mocks.searchParams = new URLSearchParams("mode=signin&path=student");
    mocks.getPendingSecondFactor.mockResolvedValue(null);
    mocks.getUserProfile.mockResolvedValue({ onboardingCompleted: true, roles: ["student"] });
  });
  afterEach(cleanup);

  it.each(["signin", "signup"])("puts the %s form before the decorative portrait with one entry switch", async (mode) => {
    mocks.auth = { status: "unauthenticated", user: null };
    mocks.searchParams = new URLSearchParams({ mode, path: "teacher", returnTo: checkout });
    const view = renderAuth();

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const formColumn = view.container.querySelector(".auth-form-col")!;
    const portrait = view.container.querySelector(".auth-aside")!;
    expect(formColumn.querySelector("form")).toBeInTheDocument();
    expect(portrait).toHaveAttribute("aria-hidden", "true");
    expect(formColumn.compareDocumentPosition(portrait) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const switchLinks = screen.getAllByRole("link", {
      name: mode === "signin" ? /New to SkillsetMind/ : /Already have an account/,
    });
    expect(switchLinks).toHaveLength(1);
    const destination = new URL(switchLinks[0].getAttribute("href")!, "https://skillset.test");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("mode")).toBe(mode === "signin" ? "signup" : "signin");
    expect(destination.searchParams.get("path")).toBe("teacher");
    expect(destination.searchParams.get("returnTo")).toBe(checkout);
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
    if (mode === "signin") await waitFor(() => expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1));
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it.each([
    { intent: "student", roles: ["student"], expected: "/learn" },
    { intent: "teacher", roles: ["teacher"], expected: "/teach" },
    { intent: "teacher", roles: ["student"], expected: "/onboarding?path=teacher" },
  ] as const)("opens $expected through loading for the existing $roles account", async ({ intent, roles, expected }) => {
    mocks.auth = { status: "authenticated", user: { ...sessionUser, roles: [...roles] } };
    mocks.searchParams = new URLSearchParams({ mode: "signin", path: intent });
    mocks.getUserProfile.mockResolvedValue({ onboardingCompleted: true, roles: [...roles] });
    const view = renderAuth();

    await continueThroughLoading(view, intent);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenLastCalledWith(expected), ROUTED);
    expect(mocks.auth.user?.roles).toEqual(roles);
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
  });

  it.each(["student", "teacher"])("preserves the checkout offer ahead of %s intent", async (intent) => {
    mocks.searchParams = new URLSearchParams({ mode: "signin", path: intent, returnTo: checkout });
    const view = renderAuth();

    await continueThroughLoading(view, intent);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenLastCalledWith(checkout), ROUTED);
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
  });

  it("keeps required onboarding and its checkout destination for a new profile", async () => {
    mocks.searchParams = new URLSearchParams({ mode: "signin", path: "student", returnTo: checkout });
    mocks.getUserProfile.mockResolvedValue({ onboardingCompleted: false, roles: ["student"] });
    const view = renderAuth();

    await continueThroughLoading(view, "student");

    await waitFor(() => expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/welcome?path=student&returnTo=%2Fcourses%2Ffocus%2Fcheckout%3Foffer%3DLAUNCH%26priceId%3Dprice-1",
    ), ROUTED);
  });

  it("waits for the initial session to resolve before continuing", async () => {
    mocks.auth = { status: "loading", user: null };
    const view = renderAuth();
    expect(mocks.router.replace).not.toHaveBeenCalled();

    mocks.auth = { status: "authenticated", user: sessionUser };
    view.rerender(<I18nProvider initialLocale="en"><AuthPage /></I18nProvider>);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/loading?next=welcome&path=student"));
  });

  it("leaves a pending second factor in the existing code form", async () => {
    mocks.auth = { status: "mfa_required", user: null };
    mocks.getPendingSecondFactor.mockResolvedValue(new MfaRequiredError("factor-test"));
    renderAuth();

    expect(await screen.findByPlaceholderText("000000")).toBeInTheDocument();
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.completeMfaSignIn).not.toHaveBeenCalled();
  });

  it("keeps an unconfirmed account in the confirmation flow", async () => {
    mocks.auth = { status: "authenticated", user: { ...sessionUser, emailVerified: false } };
    mocks.signInWithEmail.mockRejectedValue({ code: "email_not_confirmed" });
    const view = renderAuth();
    fireEvent.change(view.container.querySelector('input[type="email"]')!, { target: { value: sessionUser.email } });
    fireEvent.change(view.container.querySelector('input[type="password"]')!, { target: { value: "fixture-password" } });
    fireEvent.submit(view.container.querySelector("form")!);

    expect(await screen.findByRole("heading", { name: /email/i })).toBeInTheDocument();
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("keeps callback errors visible even when another verified session exists", async () => {
    mocks.searchParams = new URLSearchParams("mode=signin&error=otp_expired&path=student");
    renderAuth();

    expect(screen.getByRole("alert")).toHaveTextContent("That link has already been used or has expired.");
    await waitFor(() => expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1));
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("does not compete with a sign-in started inside the form after an unauthenticated entry", async () => {
    mocks.auth = { status: "unauthenticated", user: null };
    const view = renderAuth();
    fireEvent.change(view.container.querySelector('input[type="email"]')!, { target: { value: sessionUser.email } });
    await waitFor(() => expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1));

    mocks.auth = { status: "authenticated", user: sessionUser };
    view.rerender(<I18nProvider initialLocale="en"><AuthPage /></I18nProvider>);

    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(sessionUser.email!)).toBeInTheDocument();
    expect(mocks.getPendingSecondFactor).toHaveBeenCalledTimes(1);
  });
});
